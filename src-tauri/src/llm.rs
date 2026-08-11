use crate::secrets::load_secret;
use crate::structured::agent_response_schema;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub messages: Vec<LlmMessage>,
    pub endpoint: Option<String>,
    pub context_length: Option<u32>,
    #[serde(default)]
    pub cloud_api_enabled: bool,
    #[serde(default)]
    pub structured_output: bool,
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty()
        || model.len() > 200
        || !model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
    {
        return Err("Model identifier is invalid.".to_string());
    }
    Ok(())
}

fn validate_loopback_endpoint(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value).map_err(|error| format!("Endpoint is invalid: {}", error))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Local provider endpoint must use HTTP or HTTPS.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Local provider endpoint has no host.".to_string())?;
    if !matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    ) {
        return Err("Local provider endpoint must use localhost, 127.0.0.1, or ::1.".to_string());
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn response_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(500).collect());
    format!("Provider returned {}: {}", status, message)
}

fn normalized_messages(messages: &[LlmMessage]) -> Vec<LlmMessage> {
    let mut collapsed: Vec<LlmMessage> = Vec::new();
    for message in messages {
        let role = if message.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        let content = if message.role == "system" {
            format!("[Tool result]\n{}", message.content)
        } else {
            message.content.clone()
        };

        if let Some(previous) = collapsed
            .last_mut()
            .filter(|previous| previous.role == role)
        {
            previous.content.push_str("\n\n");
            previous.content.push_str(&content);
            previous.images.extend(message.images.clone());
        } else {
            collapsed.push(LlmMessage {
                role: role.to_string(),
                content,
                images: message.images.clone(),
            });
        }
    }
    collapsed
}

fn extract_openai_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    let mut parts = Vec::new();
    for item in value.get("output")?.as_array()? {
        for content in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if content.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(text) = content.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

async fn ollama_chat(request: &LlmRequest) -> Result<String, String> {
    let endpoint = validate_loopback_endpoint(
        request
            .endpoint
            .as_deref()
            .unwrap_or("http://127.0.0.1:11434"),
    )?;
    let url = endpoint
        .join("api/chat")
        .map_err(|error| format!("Ollama endpoint is invalid: {}", error))?;

    let messages: Vec<Value> = std::iter::once(json!({
        "role": "system",
        "content": request.system_prompt,
    }))
    .chain(
        normalized_messages(&request.messages)
            .into_iter()
            .map(|message| {
                let images: Vec<String> = message
                    .images
                    .iter()
                    .map(|image| {
                        image
                            .split_once(',')
                            .map(|(_, data)| data)
                            .unwrap_or(image)
                            .to_string()
                    })
                    .collect();
                if images.is_empty() {
                    json!({"role": message.role, "content": message.content})
                } else {
                    json!({"role": message.role, "content": message.content, "images": images})
                }
            }),
    )
    .collect();

    let mut payload = json!({
        "model": request.model,
        "messages": messages,
        "stream": false,
        "options": {"num_ctx": request.context_length.unwrap_or(32768)}
    });
    if request.structured_output {
        payload["format"] = agent_response_schema();
    }
    let response = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Failed to connect to Ollama: {}", error))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &body));
    }

    serde_json::from_str::<Value>(&body)
        .map_err(|error| error.to_string())?
        .pointer("/message/content")
        .and_then(Value::as_str)
        .filter(|content| !content.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Ollama returned an empty response.".to_string())
}

async fn openai_chat(app: &AppHandle, request: &LlmRequest) -> Result<String, String> {
    if !request.cloud_api_enabled {
        return Err(
            "Cloud API use is disabled. Enable it explicitly in Settings before sending a request."
                .to_string(),
        );
    }
    let api_key = load_secret(app, "openai_api_key")?
        .ok_or_else(|| "OpenAI API key is not configured.".to_string())?;

    let input: Vec<Value> = normalized_messages(&request.messages)
        .into_iter()
        .map(|message| {
            if message.images.is_empty() {
                json!({"role": message.role, "content": message.content})
            } else {
                let mut content = vec![json!({"type": "input_text", "text": message.content})];
                content.extend(
                    message
                        .images
                        .into_iter()
                        .map(|image| json!({"type": "input_image", "image_url": image})),
                );
                json!({"role": message.role, "content": content})
            }
        })
        .collect();

    let response = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": request.model,
            "instructions": request.system_prompt,
            "input": input,
            "store": false
        }))
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {}", error))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &body));
    }

    let value: Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    extract_openai_text(&value).ok_or_else(|| "OpenAI returned no text output.".to_string())
}

async fn anthropic_chat(app: &AppHandle, request: &LlmRequest) -> Result<String, String> {
    if !request.cloud_api_enabled {
        return Err(
            "Cloud API use is disabled. Enable it explicitly in Settings before sending a request."
                .to_string(),
        );
    }
    let api_key = load_secret(app, "anthropic_api_key")?
        .ok_or_else(|| "Anthropic API key is not configured.".to_string())?;

    let messages: Vec<Value> = normalized_messages(&request.messages)
        .into_iter()
        .map(|message| {
            if message.images.is_empty() {
                Ok(json!({"role": message.role, "content": message.content}))
            } else {
                let mut content = vec![json!({"type": "text", "text": message.content})];
                for image in message.images {
                    let (metadata, data) = image
                        .split_once(',')
                        .ok_or_else(|| "Image data URL is invalid.".to_string())?;
                    let media_type = metadata
                        .strip_prefix("data:")
                        .and_then(|value| value.strip_suffix(";base64"))
                        .ok_or_else(|| "Image data URL is invalid.".to_string())?;
                    content.push(json!({
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": data}
                    }));
                }
                Ok(json!({"role": message.role, "content": content}))
            }
        })
        .collect::<Result<Vec<_>, String>>()?;

    let response = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": request.model,
            "max_tokens": 4096,
            "system": request.system_prompt,
            "messages": messages
        }))
        .send()
        .await
        .map_err(|error| format!("Anthropic request failed: {}", error))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &body));
    }

    serde_json::from_str::<Value>(&body)
        .map_err(|error| error.to_string())?
        .get("content")
        .and_then(Value::as_array)
        .and_then(|content| {
            content
                .iter()
                .find(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        })
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Anthropic returned no text output.".to_string())
}

async fn airllm_chat(request: &LlmRequest) -> Result<String, String> {
    let endpoint = validate_loopback_endpoint(
        request
            .endpoint
            .as_deref()
            .unwrap_or("http://127.0.0.1:11435"),
    )?;
    let url = endpoint
        .join("v1/chat/completions")
        .map_err(|error| format!("AirLLM endpoint is invalid: {}", error))?;
    let messages: Vec<Value> = std::iter::once(json!({
        "role": "system",
        "content": request.system_prompt,
    }))
    .chain(
        normalized_messages(&request.messages)
            .into_iter()
            .map(|message| json!({"role": message.role, "content": message.content})),
    )
    .collect();

    let response = Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|error| error.to_string())?
        .post(url)
        .json(&json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": 512
        }))
        .send()
        .await
        .map_err(|error| format!("AirLLM request failed: {}", error))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &body));
    }

    serde_json::from_str::<Value>(&body)
        .map_err(|error| error.to_string())?
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "AirLLM returned no text output.".to_string())
}

#[tauri::command]
pub async fn chat_completion(app: AppHandle, request: LlmRequest) -> Result<String, String> {
    validate_model(&request.model)?;
    if request.system_prompt.len() > 200_000 {
        return Err("System prompt exceeds the 200 KB limit.".to_string());
    }

    if let Some(context_length) = request.context_length {
        if !(2_048..=262_144).contains(&context_length) {
            return Err("Context length must be between 2k and 256k tokens.".to_string());
        }
    }

    match request.provider.as_str() {
        "ollama" => ollama_chat(&request).await,
        "openai" => openai_chat(&app, &request).await,
        "anthropic" => anthropic_chat(&app, &request).await,
        "airllm" => airllm_chat(&request).await,
        _ => Err("Unknown LLM provider.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_endpoints_cannot_target_the_lan() {
        assert!(validate_loopback_endpoint("http://127.0.0.1:11434").is_ok());
        assert!(validate_loopback_endpoint("http://localhost:11434").is_ok());
        assert!(validate_loopback_endpoint("http://192.168.1.2:11434").is_err());
        assert!(validate_loopback_endpoint("file:///etc/passwd").is_err());
    }

    #[test]
    fn model_identifiers_are_bounded() {
        assert!(validate_model("Qwen/Qwen3-32B").is_ok());
        assert!(validate_model("../../bad model").is_err());
    }
}
