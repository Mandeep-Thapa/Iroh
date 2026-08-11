use crate::path_security::{
    app_dir, marker_path, safe_filename, validate_simple_id, validate_workspace_for_initialization,
    workspace_candidates,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::command;

#[derive(Serialize, Deserialize)]
struct WorkspaceMarker {
    version: u32,
    username: String,
    created_at: String,
}

fn grant_worker_access(path: &Path, username: &str) -> Result<(), String> {
    let grant = format!("{}:(OI)(CI)M", username);
    let output = Command::new("icacls")
        .arg(path)
        .arg("/grant:r")
        .arg(grant)
        .output()
        .map_err(|error| format!("Failed to run icacls: {}", error))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to grant worker access: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn write_marker(path: &Path, username: &str) -> Result<(), String> {
    let marker = WorkspaceMarker {
        version: 1,
        username: username.to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    let metadata_directory = app_dir(path);
    fs::create_dir_all(&metadata_directory)
        .map_err(|error| format!("Failed to create workspace metadata: {}", error))?;
    let content = serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?;
    fs::write(marker_path(path), content)
        .map_err(|error| format!("Failed to mark workspace: {}", error))
}

fn read_marker(path: &Path) -> Result<WorkspaceMarker, String> {
    let marker = marker_path(path);
    if !marker.exists() {
        return Err(format!(
            "Reset refused: '{}' is not an initialized Iroh workspace.",
            path.display()
        ));
    }
    let content = fs::read_to_string(marker).map_err(|error| error.to_string())?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Workspace marker is invalid: {}", error))
}

fn validate_worker_username(username: &str) -> Result<(), String> {
    validate_simple_id(username, "Worker username")?;
    if username.len() > 32 || !(username == "AI_Worker" || username.starts_with("AI_Worker_")) {
        return Err(
            "Worker accounts must be named AI_Worker or start with AI_Worker_.".to_string(),
        );
    }
    Ok(())
}

#[command]
pub fn initialize_workspace(paths_str: &str, username: &str) -> Result<String, String> {
    validate_worker_username(username)?;
    let candidates = workspace_candidates(paths_str)?;

    for candidate in &candidates {
        let resolved = validate_workspace_for_initialization(candidate)?;
        if !resolved.exists() {
            fs::create_dir_all(&resolved)
                .map_err(|error| format!("Failed to create '{}': {}", resolved.display(), error))?;
        }
        let canonical = resolved
            .canonicalize()
            .map_err(|error| format!("Failed to resolve '{}': {}", resolved.display(), error))?;

        grant_worker_access(&canonical, username)?;
        if !marker_path(&canonical).exists() {
            write_marker(&canonical, username)?;
        }
    }

    Ok(format!(
        "{} workspace(s) initialized without replacing existing ACL inheritance.",
        candidates.len()
    ))
}

#[command]
pub fn reset_workspace(paths_str: &str, username: &str) -> Result<String, String> {
    validate_worker_username(username)?;
    let _ = Command::new("taskkill")
        .args(["/F", "/FI", &format!("USERNAME eq {}", username)])
        .output();

    let candidates = workspace_candidates(paths_str)?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();

    for candidate in &candidates {
        let canonical = candidate.canonicalize().map_err(|error| {
            format!(
                "Workspace '{}' is unavailable: {}",
                candidate.display(),
                error
            )
        })?;
        let marker = read_marker(&canonical)?;
        if marker.username != username {
            return Err(format!(
                "Reset refused: workspace '{}' belongs to worker '{}'.",
                canonical.display(),
                marker.username
            ));
        }

        let recovery = app_dir(&canonical)
            .join("recovery")
            .join(format!("reset_{}", timestamp));
        fs::create_dir_all(&recovery)
            .map_err(|error| format!("Failed to create recovery area: {}", error))?;

        for entry in fs::read_dir(&canonical).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_name() == ".antigravity" {
                continue;
            }
            fs::rename(entry.path(), recovery.join(entry.file_name())).map_err(|error| {
                format!("Failed to move workspace item into recovery: {}", error)
            })?;
        }
    }

    initialize_workspace(paths_str, username)?;
    Ok(format!(
        "Workspace reset completed. Previous contents are recoverable under .antigravity/recovery/reset_{}.",
        timestamp
    ))
}

#[command]
pub fn copy_file_to_workspace(
    src: &str,
    dest_workspace: &str,
    filename: &str,
) -> Result<String, String> {
    let source = Path::new(src)
        .canonicalize()
        .map_err(|error| format!("Source file is unavailable: {}", error))?;
    if !source.is_file() {
        return Err("Source must be a regular file.".to_string());
    }

    let workspace = Path::new(dest_workspace)
        .canonicalize()
        .map_err(|error| format!("Destination workspace is unavailable: {}", error))?;
    let destination = workspace.join(safe_filename(filename)?);
    fs::copy(source, &destination).map_err(|error| format!("Failed to copy file: {}", error))?;
    Ok(format!("Copied to {}", destination.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_names_are_deliberately_scoped() {
        assert!(validate_worker_username("AI_Worker").is_ok());
        assert!(validate_worker_username("AI_Worker_dev").is_ok());
        assert!(validate_worker_username("Administrator").is_err());
    }
}
