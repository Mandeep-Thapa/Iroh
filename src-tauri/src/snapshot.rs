use crate::path_security::{app_dir, primary_workspace, validate_simple_id};
use chrono::Utc;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_SNAPSHOTS: usize = 10;
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct SnapshotManifest {
    created_at: String,
    files: Vec<String>,
    skipped_files: Vec<String>,
}

fn snapshots_directory(workspace: &Path) -> PathBuf {
    app_dir(workspace).join("snapshots")
}

fn prune_old_snapshots(root: &Path) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    let remove_count = entries.len().saturating_sub(MAX_SNAPSHOTS);
    for entry in entries.into_iter().take(remove_count) {
        fs::remove_dir_all(entry.path())
            .map_err(|error| format!("Failed to prune old snapshot: {}", error))?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_snapshot(workspace: &str) -> Result<String, String> {
    let primary = primary_workspace(workspace)?;
    let snapshot_id = format!(
        "{}_{}",
        Utc::now().format("%Y%m%dT%H%M%S%3fZ"),
        std::process::id()
    );
    let snapshots_root = snapshots_directory(&primary);
    let snapshot_directory = snapshots_root.join(&snapshot_id);
    fs::create_dir_all(&snapshot_directory)
        .map_err(|error| format!("Failed to create snapshot directory: {}", error))?;

    let mut files = Vec::new();
    let mut skipped_files = Vec::new();
    for result in WalkBuilder::new(&primary)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .build()
    {
        let Ok(entry) = result else {
            continue;
        };
        let source = entry.path();
        if source == primary
            || source
                .components()
                .any(|component| component.as_os_str() == ".antigravity")
        {
            continue;
        }
        let Ok(relative) = source.strip_prefix(&primary) else {
            continue;
        };
        let destination = snapshot_directory.join(relative);

        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            continue;
        }
        let size = entry
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(MAX_FILE_BYTES + 1);
        let relative_text = relative.to_string_lossy().to_string();
        if size > MAX_FILE_BYTES {
            skipped_files.push(relative_text);
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, destination)
            .map_err(|error| format!("Failed to snapshot '{}': {}", source.display(), error))?;
        files.push(relative_text);
    }

    let manifest = SnapshotManifest {
        created_at: Utc::now().to_rfc3339(),
        files,
        skipped_files,
    };
    fs::write(
        snapshot_directory.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    prune_old_snapshots(&snapshots_root)?;

    Ok(format!(
        "Snapshot {} created with {} files; {} oversized files skipped.",
        snapshot_id,
        manifest.files.len(),
        manifest.skipped_files.len()
    ))
}

#[tauri::command]
pub fn get_latest_snapshot(workspace: &str) -> Result<String, String> {
    let primary = primary_workspace(workspace)?;
    let root = snapshots_directory(&primary);
    if !root.exists() {
        return Ok("No snapshots available.".to_string());
    }

    let mut entries: Vec<_> = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries
        .last()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .unwrap_or_else(|| "No snapshots available.".to_string()))
}

#[tauri::command]
pub fn rollback_snapshot(workspace: &str, snapshot_id: &str) -> Result<String, String> {
    validate_simple_id(snapshot_id, "Snapshot id")?;
    let primary = primary_workspace(workspace)?;
    let snapshot_directory = snapshots_directory(&primary).join(snapshot_id);
    if !snapshot_directory.exists() {
        return Err("Snapshot does not exist.".to_string());
    }

    let manifest_path = snapshot_directory.join("manifest.json");
    let manifest: SnapshotManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("Snapshot manifest is unavailable: {}", error))?,
    )
    .map_err(|error| format!("Snapshot manifest is invalid: {}", error))?;

    let mut restored = 0usize;
    for relative_text in &manifest.files {
        let relative = Path::new(relative_text);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err("Snapshot manifest contains an unsafe path.".to_string());
        }
        let source = snapshot_directory.join(relative);
        let destination = primary.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, destination)
            .map_err(|error| format!("Failed to restore '{}': {}", relative.display(), error))?;
        restored += 1;
    }

    Ok(format!(
        "Restored {} files from {}. Files created after the snapshot were preserved.",
        restored, snapshot_id
    ))
}
