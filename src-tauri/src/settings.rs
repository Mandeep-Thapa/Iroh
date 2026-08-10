use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use serde_json::Value;

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    path.push("settings.json");
    Ok(path)
}

fn get_history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("chat_history");
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = get_settings_path(&app)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
        let json: Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
        Ok(json)
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = get_settings_path(&app)?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("Failed to write settings: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_chat_session(app: AppHandle, session_id: String, data: Value) -> Result<(), String> {
    let dir = get_history_dir(&app)?;
    let file = dir.join(format!("{}.json", session_id));
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&file, content).map_err(|e| format!("Failed to save chat: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_chat_session(app: AppHandle, session_id: String) -> Result<Value, String> {
    let dir = get_history_dir(&app)?;
    let file = dir.join(format!("{}.json", session_id));
    if file.exists() {
        let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub fn list_chat_sessions(app: AppHandle) -> Result<Value, String> {
    let dir = get_history_dir(&app)?;
    let mut sessions: Vec<Value> = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(json) = serde_json::from_str::<Value>(&content) {
                        sessions.push(json);
                    }
                }
            }
        }
    }
    
    // Sort by timestamp descending (newest first)
    sessions.sort_by(|a, b| {
        let ts_a = a.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let ts_b = b.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        ts_b.cmp(&ts_a)
    });
    
    Ok(serde_json::json!(sessions))
}

#[tauri::command]
pub fn delete_chat_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let dir = get_history_dir(&app)?;
    let file = dir.join(format!("{}.json", session_id));
    if file.exists() {
        fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(())
}
