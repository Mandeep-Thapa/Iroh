use crate::path_security::ensure_new_file_path;
use serde::Serialize;
use std::fs;

const MAX_PREVIEW_CHARS: usize = 12_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangePreview {
    path: String,
    exists: bool,
    before: String,
    after: String,
    summary: String,
}

fn bounded(value: &str) -> String {
    let mut output: String = value.chars().take(MAX_PREVIEW_CHARS).collect();
    if value.chars().count() > MAX_PREVIEW_CHARS {
        output.push_str("\n... preview truncated ...");
    }
    output
}

#[tauri::command]
pub fn preview_file_change(
    path: String,
    content: String,
    workspace: String,
) -> Result<FileChangePreview, String> {
    let destination = ensure_new_file_path(&path, &workspace)?;
    let exists = destination.exists();
    let before = if exists {
        let metadata = fs::metadata(&destination).map_err(|error| error.to_string())?;
        if metadata.len() > 2 * 1024 * 1024 {
            return Err("Existing file is too large for an approval preview.".to_string());
        }
        fs::read_to_string(&destination)
            .map_err(|_| "Existing file is not UTF-8 text and cannot be previewed.".to_string())?
    } else {
        String::new()
    };
    let old_lines = before.lines().count();
    let new_lines = content.lines().count();
    Ok(FileChangePreview {
        path: destination.display().to_string(),
        exists,
        before: bounded(&before),
        after: bounded(&content),
        summary: if exists {
            format!("Replace {} line(s) with {} line(s).", old_lines, new_lines)
        } else {
            format!("Create a new {} line file.", new_lines)
        },
    })
}
