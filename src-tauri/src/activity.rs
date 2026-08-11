use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MAX_LEDGER_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RETURNED_ENTRIES: usize = 250;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub timestamp: String,
    pub category: String,
    pub summary: String,
    pub detail: String,
    pub risk: String,
    pub status: String,
}

fn ledger_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("activity.jsonl"))
}

fn clean(value: String, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .take(max_chars)
        .collect()
}

fn read_entries(path: &PathBuf) -> Result<Vec<ActivityEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(content
        .lines()
        .filter_map(|line| serde_json::from_str::<ActivityEntry>(line).ok())
        .collect())
}

fn compact_if_needed(path: &PathBuf) -> Result<(), String> {
    if !path.exists()
        || fs::metadata(path).map_err(|error| error.to_string())?.len() <= MAX_LEDGER_BYTES
    {
        return Ok(());
    }
    let mut entries = read_entries(path)?;
    if entries.len() > MAX_RETURNED_ENTRIES {
        entries = entries.split_off(entries.len() - MAX_RETURNED_ENTRIES);
    }
    let mut content = String::new();
    for entry in entries {
        content.push_str(&serde_json::to_string(&entry).map_err(|error| error.to_string())?);
        content.push('\n');
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn append_activity(
    app: AppHandle,
    category: String,
    summary: String,
    detail: String,
    risk: String,
    status: String,
) -> Result<ActivityEntry, String> {
    let now = Utc::now();
    let entry = ActivityEntry {
        id: format!("activity_{}", now.timestamp_micros()),
        timestamp: now.to_rfc3339(),
        category: clean(category, 40),
        summary: clean(summary, 160),
        detail: clean(detail, 1200),
        risk: clean(risk, 20),
        status: clean(status, 20),
    };
    let path = ledger_path(&app)?;
    compact_if_needed(&path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&entry).map_err(|error| error.to_string())?
    )
    .map_err(|error| error.to_string())?;
    Ok(entry)
}

#[tauri::command]
pub fn list_activity(app: AppHandle) -> Result<Vec<ActivityEntry>, String> {
    let mut entries = read_entries(&ledger_path(&app)?)?;
    if entries.len() > MAX_RETURNED_ENTRIES {
        entries = entries.split_off(entries.len() - MAX_RETURNED_ENTRIES);
    }
    entries.reverse();
    Ok(entries)
}

#[tauri::command]
pub fn clear_activity(app: AppHandle) -> Result<(), String> {
    let path = ledger_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
