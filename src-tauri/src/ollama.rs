use std::process::{Command, Stdio};
use std::os::windows::process::CommandExt;

// CREATE_NO_WINDOW prevents a console window from popping up on Windows
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub fn start_ollama_daemon() -> Result<String, String> {
    // Attempt to spawn `ollama serve` in the background
    // We ignore errors on exit status because it typically exits or prints error if port is already bound
    
    let child = Command::new("ollama")
        .arg("serve")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    match child {
        Ok(_) => Ok("Ollama daemon start command issued".into()),
        Err(e) => Err(format!("Failed to spawn Ollama daemon: {}", e))
    }
}

#[tauri::command]
pub async fn fetch_ollama_models(endpoint: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    
    match client.get(&url).send().await {
        Ok(resp) => {
            match resp.text().await {
                Ok(text) => Ok(text),
                Err(e) => Err(format!("Failed to read Ollama response: {}", e))
            }
        },
        Err(e) => Err(format!("Failed to connect to Ollama: {}", e))
    }
}
