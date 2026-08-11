use crate::path_security::validate_simple_id;
use crate::secrets::store_secret;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_CHAT_BYTES: usize = 10 * 1024 * 1024;

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("settings.json"))
}

fn get_history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("chat_history");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write temporary file: {}", error))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("Failed to replace file: {}", error))?;
    }
    fs::rename(temporary, path).map_err(|error| format!("Failed to commit file: {}", error))
}

fn migrate_secret(
    app: &AppHandle,
    object: &mut serde_json::Map<String, Value>,
    legacy_key: &str,
    secret_name: &str,
) -> Result<bool, String> {
    let Some(value) = object.remove(legacy_key) else {
        return Ok(false);
    };

    if let Some(secret) = value.as_str().filter(|secret| !secret.is_empty()) {
        store_secret(app, secret_name, secret)?;
    }
    Ok(true)
}

fn sanitize_settings(app: &AppHandle, mut settings: Value) -> Result<(Value, bool), String> {
    let mut changed = false;
    if let Some(root) = settings.as_object_mut() {
        changed |= migrate_secret(app, root, "password", "worker_password")?;

        if let Some(llm_settings) = root.get_mut("llmSettings").and_then(Value::as_object_mut) {
            changed |= migrate_secret(app, llm_settings, "openaiKey", "openai_api_key")?;
            changed |= migrate_secret(app, llm_settings, "anthropicKey", "anthropic_api_key")?;
            changed |= migrate_secret(app, llm_settings, "telegramToken", "telegram_token")?;
        }
    }
    Ok((settings, changed))
}

fn write_settings(path: &Path, settings: &Value) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    atomic_write(path, &content)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = get_settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read settings: {}", error))?;
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Settings file is invalid: {}", error))?;
    let (sanitized, changed) = sanitize_settings(&app, parsed)?;
    if changed {
        write_settings(&path, &sanitized)?;
    }
    Ok(sanitized)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = get_settings_path(&app)?;
    let (sanitized, _) = sanitize_settings(&app, settings)?;
    write_settings(&path, &sanitized)
}

fn session_file(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    validate_simple_id(session_id, "Session id")?;
    Ok(get_history_dir(app)?.join(format!("{}.json", session_id)))
}

#[tauri::command]
pub fn save_chat_session(app: AppHandle, session_id: String, data: Value) -> Result<(), String> {
    let file = session_file(&app, &session_id)?;
    let content = serde_json::to_vec_pretty(&data).map_err(|error| error.to_string())?;
    if content.len() > MAX_CHAT_BYTES {
        return Err("Chat session exceeds the 10 MB storage limit.".to_string());
    }
    atomic_write(&file, &content)
}

#[tauri::command]
pub fn load_chat_session(app: AppHandle, session_id: String) -> Result<Value, String> {
    let file = session_file(&app, &session_id)?;
    if !file.exists() {
        return Err("Session not found.".to_string());
    }

    let content = fs::read_to_string(file).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_chat_sessions(app: AppHandle) -> Result<Value, String> {
    let directory = get_history_dir(&app)?;
    let mut sessions: Vec<Value> = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|extension| extension == "json")
                .unwrap_or(false)
        })
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|content| serde_json::from_str::<Value>(&content).ok())
        .collect();

    sessions.sort_by(|left, right| {
        let left_timestamp = left.get("updatedAt").and_then(Value::as_i64).unwrap_or(0);
        let right_timestamp = right.get("updatedAt").and_then(Value::as_i64).unwrap_or(0);
        right_timestamp.cmp(&left_timestamp)
    });
    Ok(serde_json::json!(sessions))
}

#[tauri::command]
pub fn delete_chat_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let file = session_file(&app, &session_id)?;
    if file.exists() {
        fs::remove_file(file).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_cannot_escape_storage() {
        assert!(validate_simple_id("chat_123", "Session id").is_ok());
        assert!(validate_simple_id("../../settings", "Session id").is_err());
    }
}
