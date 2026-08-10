use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::command;

#[command]
pub fn initialize_workspace(paths_str: &str, username: &str) -> Result<String, String> {
    let paths: Vec<&str> = paths_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    
    if paths.is_empty() {
        return Err("No valid workspace paths provided.".to_string());
    }

    for path in &paths {
        let p = Path::new(path);
        if !p.exists() {
            fs::create_dir_all(p).map_err(|e| format!("Failed to create directory {}: {}", path, e))?;
        }

        // Use icacls to set permissions
        // 1. Reset inheritance (remove inherited, copy existing)
        let _ = Command::new("icacls")
            .args([path, "/inheritance:r"])
            .output();

        // 2. Grant Admin full control
        let _ = Command::new("icacls")
            .args([path, "/grant", "Administrators:(OI)(CI)F"])
            .output();

        // 3. Grant SYSTEM full control (needed for CreateProcessWithLogonW)
        let _ = Command::new("icacls")
            .args([path, "/grant", "SYSTEM:(OI)(CI)F"])
            .output();

        // 4. Grant AI_Worker full control
        let grant_arg = format!("{}:(OI)(CI)F", username);
        let output = Command::new("icacls")
            .arg(path)
            .arg("/grant")
            .arg(&grant_arg)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        // 5. Grant current user full control (so Tauri can read/write files and create snapshots)
        let current_user = std::env::var("USERNAME").unwrap_or_else(|_| "mande".to_string());
        let user_grant_arg = format!("{}:(OI)(CI)F", current_user);
        let _ = Command::new("icacls")
            .arg(path)
            .arg("/grant")
            .arg(&user_grant_arg)
            .output();
    }

    Ok(format!("{} workspace(s) initialized with strict ACLs.", paths.len()))
}

#[command]
pub fn reset_workspace(paths_str: &str, username: &str) -> Result<String, String> {
    // 1. Kill any processes owned by AI_Worker
    let _ = Command::new("taskkill")
        .args(["/F", "/FI", &format!("USERNAME eq {}", username)])
        .output();

    // 2. Delete and recreate all workspaces
    let paths: Vec<&str> = paths_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    for path in &paths {
        let p = Path::new(path);
        if p.exists() {
            fs::remove_dir_all(p).map_err(|e| format!("Failed to delete workspace {}: {}", path, e))?;
        }
    }
    
    initialize_workspace(paths_str, username)
}

#[command]
pub fn copy_file_to_workspace(src: &str, dest_workspace: &str, filename: &str) -> Result<String, String> {
    let p = Path::new(dest_workspace).join(filename);
    fs::copy(src, &p).map_err(|e| format!("Failed to copy file: {}", e))?;
    Ok(format!("Copied to {:?}", p))
}
