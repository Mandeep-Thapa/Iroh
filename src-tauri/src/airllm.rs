use crate::secrets::load_secret;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

lazy_static::lazy_static! {
    static ref AIRLLM_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AirLlmStatus {
    running: bool,
    ready: bool,
    detail: String,
}

fn validate_python(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 260 || value.contains(['\n', '\r', '\0']) {
        return Err("Python executable is invalid.".to_string());
    }
    Ok(())
}

fn validate_model(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 200
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
    {
        return Err("AirLLM model identifier is invalid.".to_string());
    }
    Ok(())
}

fn server_script(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("scripts")
            .join("airllm_server.py");
        if path.exists() {
            return Ok(path);
        }
    }

    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("scripts")
        .join("airllm_server.py");
    if resource.exists() {
        Ok(resource)
    } else {
        Err(format!(
            "Bundled AirLLM server was not found at {}.",
            resource.display()
        ))
    }
}

fn process_running() -> bool {
    let Ok(mut guard) = AIRLLM_PROCESS.lock() else {
        return false;
    };
    let Some(child) = guard.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        _ => {
            *guard = None;
            false
        }
    }
}

#[tauri::command]
pub fn check_airllm_environment(python_path: String) -> Result<String, String> {
    validate_python(&python_path)?;
    let script = r#"import importlib.util,json
torch_ok=importlib.util.find_spec('torch') is not None
airllm_ok=importlib.util.find_spec('airllm') is not None
cuda=False
if torch_ok:
 import torch
 cuda=torch.cuda.is_available()
print(json.dumps({'python':True,'torch':torch_ok,'airllm':airllm_ok,'cuda':cuda}))"#;
    let output = Command::new(&python_path)
        .args(["-c", script])
        .output()
        .map_err(|error| format!("Failed to run Python: {}", error))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub fn start_airllm_server(
    app: AppHandle,
    python_path: String,
    model: String,
    port: u16,
    cache_dir: Option<String>,
    compression: Option<String>,
) -> Result<String, String> {
    validate_python(&python_path)?;
    validate_model(&model)?;
    if port < 1024 {
        return Err("AirLLM port must be 1024 or greater.".to_string());
    }
    if let Some(value) = compression.as_deref() {
        if !matches!(value, "4bit" | "8bit" | "none") {
            return Err("AirLLM compression must be none, 4bit, or 8bit.".to_string());
        }
    }

    let mut guard = AIRLLM_PROCESS
        .lock()
        .map_err(|_| "AirLLM process state is unavailable.".to_string())?;
    if let Some(child) = guard.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok("AirLLM server is already running.".to_string());
        }
        *guard = None;
    }

    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&log_directory).map_err(|error| error.to_string())?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_directory.join("airllm.log"))
        .map_err(|error| error.to_string())?;
    let error_file = log_file.try_clone().map_err(|error| error.to_string())?;

    let mut command = Command::new(python_path);
    command
        .arg(server_script(&app)?)
        .args(["--model", &model, "--port", &port.to_string()])
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(error_file))
        .creation_flags(0x08000000);

    if let Some(directory) = cache_dir.filter(|directory| !directory.trim().is_empty()) {
        command.args(["--cache-dir", &directory]);
    }
    if let Some(value) = compression.filter(|value| value != "none") {
        command.args(["--compression", &value]);
    }
    if let Some(token) = load_secret(&app, "huggingface_token")? {
        command.env("HF_TOKEN", &token);
        command.env("HUGGING_FACE_HUB_TOKEN", token);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start AirLLM server: {}", error))?;
    *guard = Some(child);
    Ok("AirLLM server started. Model preparation may take a long time and requires substantial disk space.".to_string())
}

#[tauri::command]
pub fn stop_airllm_server() -> Result<String, String> {
    let mut guard = AIRLLM_PROCESS
        .lock()
        .map_err(|_| "AirLLM process state is unavailable.".to_string())?;
    if let Some(mut child) = guard.take() {
        child
            .kill()
            .map_err(|error| format!("Failed to stop AirLLM: {}", error))?;
        let _ = child.wait();
        Ok("AirLLM server stopped.".to_string())
    } else {
        Ok("AirLLM server is not running.".to_string())
    }
}

#[tauri::command]
pub async fn get_airllm_status(endpoint: String) -> Result<AirLlmStatus, String> {
    let running = process_running();
    let url = format!("{}/health", endpoint.trim_end_matches('/'));
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await;

    match response {
        Ok(response) => {
            let value: serde_json::Value =
                response.json().await.map_err(|error| error.to_string())?;
            let status = value
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            Ok(AirLlmStatus {
                running: true,
                ready: status == "ready",
                detail: value
                    .get("detail")
                    .and_then(|value| value.as_str())
                    .unwrap_or(status)
                    .to_string(),
            })
        }
        Err(error) => Ok(AirLlmStatus {
            running,
            ready: false,
            detail: if running {
                "AirLLM process is starting; the health endpoint is not ready yet.".to_string()
            } else {
                format!("AirLLM is not reachable: {}", error)
            },
        }),
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;
