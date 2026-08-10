use ignore::WalkBuilder;
use std::path::Path;
use std::fs;
use tauri::command;

#[command]
pub fn create_snapshot(workspace: &str) -> Result<String, String> {
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary = workspaces.first().copied().unwrap_or("C:\\");
    let primary_path = Path::new(primary);
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
        
    let snapshot_dir = primary_path.join(".antigravity").join("snapshots").join(timestamp.to_string());
    if !snapshot_dir.exists() {
        fs::create_dir_all(&snapshot_dir).map_err(|e| format!("Failed to create snapshot dir: {}", e))?;
    }

    let walker = WalkBuilder::new(primary)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .build();

    let mut count = 0;
    for result in walker {
        if let Ok(entry) = result {
            let path = entry.path();
            if path == primary_path { continue; } // skip root
            
            // Skip .antigravity itself
            if path.components().any(|c| c.as_os_str() == ".antigravity") {
                continue;
            }

            // Get relative path
            if let Ok(rel_path) = path.strip_prefix(primary_path) {
                let dest = snapshot_dir.join(rel_path);
                
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let _ = fs::create_dir_all(&dest);
                } else {
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(path, &dest).is_ok() {
                        count += 1;
                    }
                }
            }
        }
    }

    Ok(format!("Snapshot created with {} files.", count))
}

#[command]
pub fn get_latest_snapshot(workspace: &str) -> Result<String, String> {
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary = workspaces.first().copied().unwrap_or("C:\\");
    
    let snapshots_dir = Path::new(primary).join(".antigravity").join("snapshots");
    if !snapshots_dir.exists() {
        return Ok("No snapshots available.".to_string());
    }
    
    let mut entries: Vec<_> = fs::read_dir(&snapshots_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
        
    entries.sort_by_key(|e| e.file_name());
    
    if let Some(latest) = entries.last() {
        Ok(latest.file_name().to_string_lossy().to_string())
    } else {
        Ok("No snapshots available.".to_string())
    }
}

#[command]
pub fn rollback_snapshot(workspace: &str, snapshot_id: &str) -> Result<String, String> {
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary = workspaces.first().copied().unwrap_or("C:\\");
    let primary_path = Path::new(primary);
    
    let snapshot_dir = primary_path.join(".antigravity").join("snapshots").join(snapshot_id);
    if !snapshot_dir.exists() {
        return Err("Snapshot does not exist".to_string());
    }

    let walker = WalkBuilder::new(&snapshot_dir)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .build();

    let mut count = 0;
    for result in walker {
        if let Ok(entry) = result {
            let path = entry.path();
            if path == snapshot_dir { continue; }
            
            if let Ok(rel_path) = path.strip_prefix(&snapshot_dir) {
                let dest = primary_path.join(rel_path);
                
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let _ = fs::create_dir_all(&dest);
                } else {
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(path, &dest).is_ok() {
                        count += 1;
                    }
                }
            }
        }
    }

    Ok(format!("Restored {} files from snapshot.", count))
}
