use crate::path_security::{ensure_existing_path, primary_workspace, validate_simple_id};
use crate::settings;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use tauri::AppHandle;

const MAX_IMPORT_BYTES: u64 = 30 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableBundle {
    version: u32,
    exported_at: String,
    settings: Value,
    chats: Vec<Value>,
}

#[tauri::command]
pub fn export_portable_bundle(app: AppHandle, workspace: String) -> Result<String, String> {
    let root = primary_workspace(&workspace)?;
    let bundle = PortableBundle {
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        settings: settings::load_settings(app.clone())?,
        chats: settings::list_chat_sessions(app)?
            .as_array()
            .cloned()
            .unwrap_or_default(),
    };
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let destination = root.join(format!("iroh-portable-{}.json", timestamp));
    let content = serde_json::to_vec_pretty(&bundle).map_err(|error| error.to_string())?;
    if content.len() as u64 > MAX_IMPORT_BYTES {
        return Err("Portable bundle exceeds the 30 MB safety limit.".to_string());
    }
    fs::write(&destination, content).map_err(|error| error.to_string())?;
    Ok(destination.display().to_string())
}

#[tauri::command]
pub fn import_portable_bundle(
    app: AppHandle,
    workspace: String,
    path: String,
) -> Result<String, String> {
    let source = ensure_existing_path(&path, &workspace)?;
    if !source.is_file() {
        return Err("Portable bundle must be a regular file.".to_string());
    }
    if fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_IMPORT_BYTES
    {
        return Err("Portable bundle exceeds the 30 MB safety limit.".to_string());
    }
    let content = fs::read(&source).map_err(|error| error.to_string())?;
    let bundle: PortableBundle =
        serde_json::from_slice(&content).map_err(|error| format!("Invalid bundle: {}", error))?;
    if bundle.version != 1 {
        return Err(format!(
            "Unsupported portable bundle version {}.",
            bundle.version
        ));
    }

    settings::save_settings(app.clone(), bundle.settings)?;
    let mut imported = 0usize;
    for chat in bundle.chats {
        let Some(id) = chat.get("id").and_then(Value::as_str) else {
            continue;
        };
        if validate_simple_id(id, "Session id").is_err() {
            continue;
        }
        settings::save_chat_session(app.clone(), id.to_string(), chat)?;
        imported += 1;
    }
    Ok(format!(
        "Imported settings and {} chat session(s). Restart Iroh to reload every preference.",
        imported
    ))
}
