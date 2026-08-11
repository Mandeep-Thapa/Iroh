use reqwest::Url;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn local_endpoint(endpoint: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(endpoint).map_err(|error| format!("Ollama endpoint is invalid: {}", error))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Ollama endpoint must use HTTP or HTTPS.".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
        return Err("Ollama endpoint must be local.".to_string());
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn valid_model_identifier(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 200
        && model.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | '-' | ':' | '/' | '@')
        })
}

#[tauri::command]
pub fn start_ollama_daemon() -> Result<String, String> {
    Command::new("ollama")
        .arg("serve")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| "Ollama daemon start command issued.".to_string())
        .map_err(|error| format!("Failed to start Ollama: {}", error))
}

#[tauri::command]
pub async fn fetch_ollama_models(endpoint: &str) -> Result<String, String> {
    let url = local_endpoint(endpoint)?
        .join("api/tags")
        .map_err(|error| error.to_string())?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to connect to Ollama: {}", error))?;
    if !response.status().is_success() {
        return Err(format!("Ollama returned {}.", response.status()));
    }
    response.text().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn fetch_ollama_model_details(endpoint: &str, model: &str) -> Result<String, String> {
    if !valid_model_identifier(model) {
        return Err("Ollama model identifier is invalid.".to_string());
    }
    let url = local_endpoint(endpoint)?
        .join("api/show")
        .map_err(|error| error.to_string())?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?
        .post(url)
        .json(&serde_json::json!({ "model": model }))
        .send()
        .await
        .map_err(|error| format!("Failed to inspect Ollama model: {}", error))?;
    if !response.status().is_success() {
        return Err(format!(
            "Ollama returned {} while inspecting the model.",
            response.status()
        ));
    }
    response.text().await.map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_ollama_endpoints() {
        assert!(local_endpoint("http://127.0.0.1:11434").is_ok());
        assert!(local_endpoint("http://10.0.0.2:11434").is_err());
    }

    #[test]
    fn validates_model_identifiers() {
        assert!(valid_model_identifier("qwen3:4b"));
        assert!(valid_model_identifier("registry/model:latest"));
        assert!(!valid_model_identifier("../../escape model"));
    }
}
