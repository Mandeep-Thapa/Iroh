use std::os::windows::ffi::OsStrExt;
use std::ffi::OsStr;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::System::Threading::{
    CreateProcessWithLogonW, LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTUPINFOW, 
    CREATE_NO_WINDOW
};
use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED};
use tauri::{command, Emitter};

fn to_pcwstr(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

#[command]
pub fn execute_sandboxed_cmd(
    window: tauri::Window,
    command: &str,
    username: &str,
    password: &str,
    workspace: &str,
) -> Result<String, String> {
    let paths: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary_workspace = paths.first().copied().unwrap_or("C:\\");

    // Use a unique temp file name to avoid collisions
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let script_file = format!("{}\\__script_{}.ps1", primary_workspace, timestamp);
    let output_file = format!("{}\\__cmd_out_{}.txt", primary_workspace, timestamp);
    
    // Write the raw command to a .ps1 file to completely avoid quoting issues
    if let Err(e) = std::fs::write(&script_file, command) {
        return Err(format!("Failed to write script temp file: {}", e));
    }
    
    // Wrap the script execution in cmd.exe for easy stdout+stderr redirection
    let cmd_line = format!(
        "cmd.exe /S /C \"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\" > \"{}\" 2>&1\"",
        script_file, output_file
    );
    
    let user_w = to_pcwstr(username);
    let pass_w = to_pcwstr(password);
    let cmd_w = to_pcwstr(&cmd_line);
    let dir_w = to_pcwstr(primary_workspace);

    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let mut cmd_w_mut = cmd_w.clone();

    let success = unsafe {
        CreateProcessWithLogonW(
            PCWSTR(user_w.as_ptr()),
            PCWSTR(std::ptr::null()), // Domain
            PCWSTR(pass_w.as_ptr()),
            LOGON_WITH_PROFILE,
            PCWSTR(std::ptr::null()), // App name
            PWSTR(cmd_w_mut.as_mut_ptr()), // Command line
            CREATE_NO_WINDOW,
            None, // Environment
            PCWSTR(dir_w.as_ptr()), // Current dir = workspace
            &mut si,
            &mut pi,
        )
    };

    if success.is_err() {
        let err = success.unwrap_err();
        if err.code() == ERROR_ACCESS_DENIED.into() {
            return Err("Security Enforcer Block: Access Denied. The AI_Worker account does not have permission.".into());
        }
        return Err(format!("Failed to spawn process: {}", err));
    }

    // Wait for the process to complete (with a 30 second timeout)
    unsafe {
        windows::Win32::System::Threading::WaitForSingleObject(pi.hProcess, 30000);
        let _ = CloseHandle(pi.hProcess);
        let _ = CloseHandle(pi.hThread);
    }

    // Read the output file (we run as admin, so we can always read it)
    let out = std::fs::read_to_string(&output_file).unwrap_or_else(|e| {
        format!("Command executed but output could not be read: {}", e)
    });
    let _ = std::fs::remove_file(&output_file);
    let _ = std::fs::remove_file(&script_file);

    // Emit event for terminal bridge
    let _ = window.emit("terminal-output", &out);

    Ok(out)
}

fn enforce_workspace_boundary(path: &str, workspace: &str) -> Result<std::path::PathBuf, String> {
    let target = std::path::Path::new(path).canonicalize().unwrap_or_else(|_| std::path::PathBuf::from(path));
    
    // Check if target starts with any of the workspace paths
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    
    for ws in workspaces {
        let ws_path = std::path::Path::new(ws).canonicalize().unwrap_or_else(|_| std::path::PathBuf::from(ws));
        if target.starts_with(&ws_path) {
            return Ok(target);
        }
    }
    
    Err(format!("Security Block: Path '{}' is outside of allowed workspaces.", path))
}

#[command]
pub fn read_file_safe(path: &str, workspace: &str) -> Result<String, String> {
    let safe_path = enforce_workspace_boundary(path, workspace)?;
    
    if safe_path.extension().and_then(|e| e.to_str()).unwrap_or("").eq_ignore_ascii_case("pdf") {
        return pdf_extract::extract_text(&safe_path).map_err(|e| format!("Failed to extract PDF text: {}", e));
    }
    
    std::fs::read_to_string(&safe_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[command]
pub fn write_file_safe(path: &str, content: &str, workspace: &str) -> Result<String, String> {
    // If it doesn't exist, canonicalize will fail, so we check parent.
    let path_obj = std::path::Path::new(path);
    if let Some(parent) = path_obj.parent() {
        let safe_parent = enforce_workspace_boundary(parent.to_str().unwrap_or(""), workspace)?;
        let full_path = safe_parent.join(path_obj.file_name().unwrap_or_default());
        std::fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
        Ok(format!("Successfully wrote to {}", full_path.display()))
    } else {
        Err("Invalid path".to_string())
    }
}

#[command]
pub fn list_dir_safe(path: &str, workspace: &str) -> Result<String, String> {
    let safe_path = enforce_workspace_boundary(path, workspace)?;
    let mut entries = Vec::new();
    
    for entry in std::fs::read_dir(&safe_path).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        entries.push(if is_dir { format!("{}/", name) } else { name });
    }
    
    Ok(entries.join("\n"))
}

#[command]
pub fn remember_safe(content: &str, workspace: &str) -> Result<String, String> {
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary = workspaces.first().copied().unwrap_or("C:\\");
    let primary_path = std::path::Path::new(primary);
    
    let antigravity_dir = primary_path.join(".antigravity");
    if !antigravity_dir.exists() {
        std::fs::create_dir_all(&antigravity_dir).map_err(|e| format!("Failed to create .antigravity dir: {}", e))?;
    }
    
    let knowledge_file = antigravity_dir.join("knowledge.md");
    
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&knowledge_file)
        .map_err(|e| format!("Failed to open knowledge file: {}", e))?;
        
    writeln!(file, "\n- {}", content).map_err(|e| format!("Failed to write knowledge: {}", e))?;
    
    Ok("Memory saved.".to_string())
}

#[command]
pub fn read_knowledge_safe(workspace: &str) -> Result<String, String> {
    let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let primary = workspaces.first().copied().unwrap_or("C:\\");
    let primary_path = std::path::Path::new(primary);
    
    let knowledge_file = primary_path.join(".antigravity").join("knowledge.md");
    if knowledge_file.exists() {
        std::fs::read_to_string(&knowledge_file).map_err(|e| format!("Failed to read knowledge file: {}", e))
    } else {
        Ok("".to_string())
    }
}

#[command]
pub fn read_image_base64(path: &str, workspace: &str) -> Result<String, String> {
    let resolved_path = enforce_workspace_boundary(path, workspace)?;
    let bytes = std::fs::read(&resolved_path).map_err(|e| format!("Failed to read image: {}", e))?;
    
    let ext = resolved_path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[command]
pub fn search_document(path: &str, query: &str, workspace: &str) -> Result<String, String> {
    // Basic Naive RAG (TF-IDF approximation via word overlap)
    let content = read_file_safe(path, workspace)?;
    
    let query_words: Vec<String> = query.to_lowercase()
        .split_whitespace()
        .map(|s| s.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|s| !s.is_empty())
        .collect();
        
    let chunks: Vec<&str> = content.split("\n\n").collect();
    
    let mut scored_chunks: Vec<(usize, usize, &str)> = chunks.into_iter().enumerate().map(|(i, chunk)| {
        let chunk_lower = chunk.to_lowercase();
        let mut score = 0;
        for word in &query_words {
            if chunk_lower.contains(word) {
                score += 1;
            }
        }
        (score, i, chunk)
    }).collect();
    
    scored_chunks.sort_by(|a, b| b.0.cmp(&a.0));
    
    let top_chunks: Vec<String> = scored_chunks.into_iter()
        .filter(|(s, _, _)| *s > 0)
        .take(5)
        .map(|(s, _, c)| format!("(Score: {})\n{}", s, c.trim()))
        .collect();
        
    if top_chunks.is_empty() {
        return Ok("No relevant sections found.".to_string());
    }
    
    Ok(format!("Top relevant sections for '{}':\n\n{}", query, top_chunks.join("\n\n---\n\n")))
}
