use crate::path_security::{app_dir, primary_workspace};
use chrono::Utc;
use ignore::WalkBuilder;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const INDEX_VERSION: u32 = 1;
const MAX_FILES: usize = 350;
const MAX_TOTAL_TEXT_BYTES: usize = 6 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_CHUNKS: usize = 1500;
const TARGET_CHUNK_CHARS: usize = 1200;
const MAX_EMBED_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_INDEX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeChunk {
    path: String,
    line_start: usize,
    line_end: usize,
    text: String,
    embedding: Option<Vec<f32>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndex {
    version: u32,
    created_at: String,
    embedding_model: Option<String>,
    chunks: Vec<KnowledgeChunk>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBuildReport {
    files_indexed: usize,
    chunks_indexed: usize,
    embedded: bool,
    index_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeHit {
    path: String,
    line_start: usize,
    line_end: usize,
    score: f32,
    text: String,
}

fn index_path(root: &Path) -> PathBuf {
    app_dir(root).join("knowledge_index.json")
}

fn local_ollama_endpoint(endpoint: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(endpoint).map_err(|error| format!("Ollama endpoint is invalid: {}", error))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Ollama endpoint must use HTTP or HTTPS.".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
        return Err("Knowledge embeddings must use a loopback Ollama endpoint.".to_string());
    }
    url.set_path("api/embed");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn supported_text_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "txt"
            | "md"
            | "markdown"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "py"
            | "java"
            | "kt"
            | "go"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "cs"
            | "html"
            | "css"
            | "scss"
            | "sql"
            | "xml"
            | "csv"
            | "env.example"
    )
}

fn chunk_file(root: &Path, path: &Path, content: &str) -> Vec<KnowledgeChunk> {
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string();
    let lines: Vec<&str> = content.lines().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < lines.len() && chunks.len() < MAX_CHUNKS {
        let mut end = start;
        let mut chars = 0usize;
        while end < lines.len() {
            let next = lines[end].chars().count() + 1;
            if end > start && chars + next > TARGET_CHUNK_CHARS {
                break;
            }
            chars += next;
            end += 1;
        }
        let text = lines[start..end].join("\n").trim().to_string();
        if !text.is_empty() {
            chunks.push(KnowledgeChunk {
                path: relative.clone(),
                line_start: start + 1,
                line_end: end,
                text,
                embedding: None,
            });
        }
        start = end.max(start + 1);
    }
    chunks
}

async fn embed_texts(
    endpoint: &str,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if model.is_empty() || model.len() > 200 {
        return Err("Embedding model identifier is invalid.".to_string());
    }
    let mut response = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?
        .post(local_ollama_endpoint(endpoint)?)
        .json(&json!({ "model": model, "input": texts }))
        .send()
        .await
        .map_err(|error| format!("Local embedding request failed: {}", error))?;
    if !response.status().is_success() {
        return Err(format!(
            "Ollama embedding request returned {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_EMBED_RESPONSE_BYTES as u64)
    {
        return Err("Ollama embedding response exceeded the 8 MB safety limit.".to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len() + chunk.len() > MAX_EMBED_RESPONSE_BYTES {
            return Err("Ollama embedding response exceeded the 8 MB safety limit.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Ollama returned invalid JSON: {}", error))?;
    serde_json::from_value(value.get("embeddings").cloned().unwrap_or_default())
        .map_err(|error| format!("Ollama returned invalid embeddings: {}", error))
}

fn terms(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| term.len() > 1)
        .map(str::to_lowercase)
        .collect()
}

fn cosine(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    let dot: f32 = left.iter().zip(right).map(|(a, b)| a * b).sum();
    let left_norm: f32 = left.iter().map(|value| value * value).sum::<f32>().sqrt();
    let right_norm: f32 = right.iter().map(|value| value * value).sum::<f32>().sqrt();
    if left_norm == 0.0 || right_norm == 0.0 {
        0.0
    } else {
        dot / (left_norm * right_norm)
    }
}

#[tauri::command]
pub async fn build_workspace_knowledge(
    workspace: String,
    ollama_endpoint: String,
    embedding_model: Option<String>,
) -> Result<KnowledgeBuildReport, String> {
    let root = primary_workspace(&workspace)?;
    let mut chunks = Vec::new();
    let mut files_indexed = 0usize;
    let mut total_bytes = 0usize;

    for result in WalkBuilder::new(&root)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .build()
    {
        let Ok(entry) = result else { continue };
        let path = entry.path();
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
            || !supported_text_file(path)
            || files_indexed >= MAX_FILES
            || chunks.len() >= MAX_CHUNKS
        {
            continue;
        }
        let metadata = match fs::metadata(path) {
            Ok(value) if value.len() <= MAX_FILE_BYTES => value,
            _ => continue,
        };
        if total_bytes + metadata.len() as usize > MAX_TOTAL_TEXT_BYTES {
            break;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        total_bytes += content.len();
        files_indexed += 1;
        chunks.extend(chunk_file(&root, path, &content));
        chunks.truncate(MAX_CHUNKS);
    }

    let model = embedding_model.filter(|value| !value.trim().is_empty());
    if let Some(model_name) = model.as_deref() {
        for batch_start in (0..chunks.len()).step_by(24) {
            let batch_end = (batch_start + 24).min(chunks.len());
            let texts: Vec<String> = chunks[batch_start..batch_end]
                .iter()
                .map(|chunk| chunk.text.clone())
                .collect();
            let embeddings = embed_texts(&ollama_endpoint, model_name, &texts).await?;
            if embeddings.len() != texts.len() {
                return Err("Ollama returned the wrong number of embeddings.".to_string());
            }
            for (chunk, embedding) in chunks[batch_start..batch_end].iter_mut().zip(embeddings) {
                chunk.embedding = Some(embedding);
            }
        }
    }

    let index = KnowledgeIndex {
        version: INDEX_VERSION,
        created_at: Utc::now().to_rfc3339(),
        embedding_model: model.clone(),
        chunks,
    };
    let path = index_path(&root);
    fs::create_dir_all(path.parent().unwrap_or(&root)).map_err(|error| error.to_string())?;
    let content = serde_json::to_vec(&index).map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(KnowledgeBuildReport {
        files_indexed,
        chunks_indexed: index.chunks.len(),
        embedded: model.is_some(),
        index_path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn search_workspace_knowledge(
    workspace: String,
    ollama_endpoint: String,
    query: String,
) -> Result<Vec<KnowledgeHit>, String> {
    if query.trim().is_empty() || query.len() > 1000 {
        return Err("Knowledge query must contain between 1 and 1000 characters.".to_string());
    }
    let root = primary_workspace(&workspace)?;
    let path = index_path(&root);
    let index_size = fs::metadata(&path)
        .map_err(|_| "Build the workspace knowledge index before searching it.".to_string())?
        .len();
    if index_size > MAX_INDEX_BYTES {
        return Err(
            "Workspace knowledge index exceeded the 64 MB safety limit; rebuild it.".to_string(),
        );
    }

    let content = fs::read(&path)
        .map_err(|_| "Build the workspace knowledge index before searching it.".to_string())?;
    let index: KnowledgeIndex =
        serde_json::from_slice(&content).map_err(|error| error.to_string())?;
    if index.version != INDEX_VERSION {
        return Err("Workspace knowledge index must be rebuilt.".to_string());
    }

    let query_embedding = if let Some(model) = index.embedding_model.as_deref() {
        embed_texts(&ollama_endpoint, model, &[query.clone()])
            .await?
            .into_iter()
            .next()
    } else {
        None
    };
    let query_terms = terms(&query);
    let mut scored: Vec<(f32, &KnowledgeChunk)> = index
        .chunks
        .iter()
        .map(|chunk| {
            let score = match (&query_embedding, &chunk.embedding) {
                (Some(query_vector), Some(chunk_vector)) => cosine(query_vector, chunk_vector),
                _ => {
                    let chunk_terms = terms(&chunk.text);
                    let overlap = query_terms.intersection(&chunk_terms).count() as f32;
                    overlap / query_terms.len().max(1) as f32
                }
            };
            (score, chunk)
        })
        .filter(|(score, _)| *score > 0.0)
        .collect();
    scored.sort_by(|left, right| right.0.total_cmp(&left.0));
    Ok(scored
        .into_iter()
        .take(8)
        .map(|(score, chunk)| KnowledgeHit {
            path: chunk.path.clone(),
            line_start: chunk.line_start,
            line_end: chunk.line_end,
            score,
            text: chunk.text.clone(),
        })
        .collect())
}
