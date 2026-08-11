use crate::path_security::{
    app_dir, ensure_existing_path, ensure_new_file_path, primary_workspace,
};
use crate::secrets::load_secret;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use tauri::{command, AppHandle, Emitter};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, WAIT_TIMEOUT};
use windows::Win32::System::Threading::{
    CreateProcessWithLogonW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
    CREATE_NO_WINDOW, LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTUPINFOW,
};

const COMMAND_TIMEOUT_MS: u32 = 60_000;
const MAX_COMMAND_BYTES: usize = 256 * 1024;
const MAX_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn unique_suffix() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}_{}", std::process::id(), timestamp)
}

fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

#[command]
pub fn execute_sandboxed_cmd(
    app: AppHandle,
    window: tauri::Window,
    command: &str,
    username: &str,
    workspace: &str,
) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Command cannot be empty.".to_string());
    }
    if command.len() > MAX_COMMAND_BYTES {
        return Err("Command exceeds the 256 KB execution limit.".to_string());
    }

    let password = load_secret(&app, "worker_password")?
        .ok_or_else(|| "Worker password is not configured.".to_string())?;
    let primary = primary_workspace(workspace)?;
    let temporary_directory = app_dir(&primary).join("tmp");
    fs::create_dir_all(&temporary_directory)
        .map_err(|error| format!("Failed to create command temporary directory: {}", error))?;

    let suffix = unique_suffix();
    let script_file = temporary_directory.join(format!("script_{}.ps1", suffix));
    let output_file = temporary_directory.join(format!("output_{}.txt", suffix));
    let wrapped_script = format!(
        "$ErrorActionPreference = 'Continue'\n& {{\n{}\n}} *>&1 | Out-File -LiteralPath '{}' -Encoding utf8\nexit $LASTEXITCODE\n",
        command,
        powershell_literal(&output_file)
    );
    fs::write(&script_file, wrapped_script)
        .map_err(|error| format!("Failed to write temporary command script: {}", error))?;

    let command_line = format!(
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
        script_file.display()
    );
    let user_wide = to_wide(username);
    let password_wide = to_wide(&password);
    let directory_wide = to_wide(&primary.to_string_lossy());
    let mut command_wide = to_wide(&command_line);
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();

    let creation = unsafe {
        CreateProcessWithLogonW(
            PCWSTR(user_wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR(password_wide.as_ptr()),
            LOGON_WITH_PROFILE,
            PCWSTR::null(),
            PWSTR(command_wide.as_mut_ptr()),
            CREATE_NO_WINDOW,
            None,
            PCWSTR(directory_wide.as_ptr()),
            &startup,
            &mut process,
        )
    };

    if let Err(error) = creation {
        let _ = fs::remove_file(&script_file);
        if error.code() == ERROR_ACCESS_DENIED.into() {
            return Err(
                "Security enforcer: the restricted worker was denied access. Verify its password and workspace ACL."
                    .to_string(),
            );
        }
        return Err(format!(
            "Failed to start restricted worker process: {}",
            error
        ));
    }

    let wait_result = unsafe { WaitForSingleObject(process.hProcess, COMMAND_TIMEOUT_MS) };
    let timed_out = wait_result == WAIT_TIMEOUT;
    if timed_out {
        unsafe {
            let _ = TerminateProcess(process.hProcess, 124);
            WaitForSingleObject(process.hProcess, 5_000);
        }
    }

    let mut exit_code = 1u32;
    unsafe {
        let _ = GetExitCodeProcess(process.hProcess, &mut exit_code);
        let _ = CloseHandle(process.hProcess);
        let _ = CloseHandle(process.hThread);
    }

    let mut output = fs::read_to_string(&output_file)
        .unwrap_or_else(|error| format!("Command produced no readable output: {}", error));
    if output.starts_with('?') {
        output.remove(0);
    }
    let _ = fs::remove_file(&output_file);
    let _ = fs::remove_file(&script_file);

    if timed_out {
        output.push_str("\n[Command stopped after the 60 second time limit.]");
    } else {
        output.push_str(&format!("\n[Exit code: {}]", exit_code));
    }

    let _ = window.emit("terminal-output", &output);
    Ok(output)
}

fn enforce_size(path: &Path, maximum: u64, label: &str) -> Result<(), String> {
    let size = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {}", label, error))?
        .len();
    if size > maximum {
        Err(format!(
            "{} exceeds the {} MB safety limit.",
            label,
            maximum / 1024 / 1024
        ))
    } else {
        Ok(())
    }
}

#[command]
pub fn read_file_safe(path: &str, workspace: &str) -> Result<String, String> {
    let safe_path = ensure_existing_path(path, workspace)?;
    if !safe_path.is_file() {
        return Err("Requested path is not a regular file.".to_string());
    }

    if safe_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf")
    {
        enforce_size(&safe_path, MAX_DOCUMENT_BYTES, "PDF")?;
        return pdf_extract::extract_text(&safe_path)
            .map_err(|error| format!("Failed to extract PDF text: {}", error));
    }

    enforce_size(&safe_path, MAX_TEXT_FILE_BYTES, "Text file")?;
    fs::read_to_string(&safe_path).map_err(|error| format!("Failed to read file: {}", error))
}

#[command]
pub fn write_file_safe(path: &str, content: &str, workspace: &str) -> Result<String, String> {
    let destination = ensure_new_file_path(path, workspace)?;
    if destination.is_dir() {
        return Err("Destination is a directory.".to_string());
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "Destination has no parent directory.".to_string())?;
    let temporary = parent.join(format!(".antigravity_write_{}.tmp", unique_suffix()));
    fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write temporary file: {}", error))?;
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Failed to replace destination: {}", error))?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Failed to commit file: {}", error))?;
    Ok(format!("Successfully wrote {}", destination.display()))
}

#[command]
pub fn list_dir_safe(path: &str, workspace: &str) -> Result<String, String> {
    let safe_path = ensure_existing_path(path, workspace)?;
    if !safe_path.is_dir() {
        return Err("Requested path is not a directory.".to_string());
    }

    let mut entries = fs::read_dir(safe_path)
        .map_err(|error| format!("Failed to read directory: {}", error))?
        .map(|entry| {
            entry.map_err(|error| error.to_string()).and_then(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                let file_type = entry.file_type().map_err(|error| error.to_string())?;
                Ok(if file_type.is_dir() {
                    format!("{}/", name)
                } else {
                    name
                })
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    entries.sort_by_key(|value| value.to_lowercase());
    Ok(entries.join("\n"))
}

#[command]
pub fn remember_safe(content: &str, workspace: &str) -> Result<String, String> {
    if content.trim().is_empty() || content.len() > 16_384 {
        return Err("Memory must contain between 1 and 16,384 characters.".to_string());
    }

    let primary = primary_workspace(workspace)?;
    let metadata_directory = app_dir(&primary);
    fs::create_dir_all(&metadata_directory)
        .map_err(|error| format!("Failed to create memory directory: {}", error))?;
    let knowledge_file = metadata_directory.join("knowledge.md");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&knowledge_file)
        .map_err(|error| format!("Failed to open memory file: {}", error))?;
    writeln!(file, "\n- {}", content.trim())
        .map_err(|error| format!("Failed to save memory: {}", error))?;
    Ok("Memory saved.".to_string())
}

#[command]
pub fn read_knowledge_safe(workspace: &str) -> Result<String, String> {
    let primary = primary_workspace(workspace)?;
    let knowledge_file = app_dir(&primary).join("knowledge.md");
    if !knowledge_file.exists() {
        return Ok(String::new());
    }
    enforce_size(&knowledge_file, 1024 * 1024, "Memory file")?;
    fs::read_to_string(knowledge_file).map_err(|error| format!("Failed to read memory: {}", error))
}

#[command]
pub fn read_image_base64(path: &str, workspace: &str) -> Result<String, String> {
    let resolved = ensure_existing_path(path, workspace)?;
    enforce_size(&resolved, MAX_IMAGE_BYTES, "Image")?;
    let mime = match resolved
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Supported image types are PNG, JPEG, GIF, and WebP.".to_string()),
    };
    let bytes = fs::read(&resolved).map_err(|error| format!("Failed to read image: {}", error))?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

fn terms(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| term.len() > 1)
        .map(str::to_lowercase)
        .collect()
}

#[command]
pub fn search_document(path: &str, query: &str, workspace: &str) -> Result<String, String> {
    let content = read_file_safe(path, workspace)?;
    let query_terms: HashSet<String> = terms(query).into_iter().collect();
    if query_terms.is_empty() {
        return Err("Search query contains no searchable terms.".to_string());
    }

    let chunks: Vec<&str> = content
        .split("\n\n")
        .map(str::trim)
        .filter(|chunk| !chunk.is_empty())
        .take(20_000)
        .collect();
    if chunks.is_empty() {
        return Ok("No searchable content found.".to_string());
    }

    let chunk_terms: Vec<Vec<String>> = chunks.iter().map(|chunk| terms(chunk)).collect();
    let mut document_frequency: HashMap<&String, usize> = HashMap::new();
    for term in &query_terms {
        let count = chunk_terms
            .iter()
            .filter(|values| values.iter().any(|value| value == term))
            .count();
        document_frequency.insert(term, count);
    }

    let total_chunks = chunks.len() as f64;
    let mut scored: Vec<(f64, usize)> = chunk_terms
        .iter()
        .enumerate()
        .map(|(index, values)| {
            let length = values.len().max(1) as f64;
            let score = query_terms
                .iter()
                .map(|term| {
                    let frequency =
                        values.iter().filter(|value| *value == term).count() as f64 / length;
                    let documents = *document_frequency.get(term).unwrap_or(&0) as f64;
                    let inverse_frequency = ((total_chunks + 1.0) / (documents + 1.0)).ln() + 1.0;
                    frequency * inverse_frequency
                })
                .sum();
            (score, index)
        })
        .filter(|(score, _)| *score > 0.0)
        .collect();
    scored.sort_by(|left, right| right.0.total_cmp(&left.0));

    let results: Vec<String> = scored
        .into_iter()
        .take(5)
        .map(|(score, index)| format!("(Relevance: {:.3})\n{}", score, chunks[index]))
        .collect();

    if results.is_empty() {
        Ok("No relevant sections found.".to_string())
    } else {
        Ok(format!(
            "Top locally-ranked sections for '{}':\n\n{}",
            query,
            results.join("\n\n---\n\n")
        ))
    }
}
