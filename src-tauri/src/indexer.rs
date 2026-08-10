use std::path::Path;
use ignore::WalkBuilder;
use serde::Serialize;

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn get_workspace_tree(path: String) -> Result<String, String> {
    let root = Path::new(&path);
    if !root.exists() || !root.is_dir() {
        return Err("Invalid workspace path".into());
    }

    let mut tree_string = String::new();
    
    // We only want a flat-ish indented string representation to inject into the system prompt.
    // E.g.
    // src/
    //   main.rs
    //   lib.rs
    // Cargo.toml
    
    let walker = WalkBuilder::new(&path)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .build();

    for result in walker {
        match result {
            Ok(entry) => {
                let depth = entry.depth();
                if depth == 0 {
                    continue; // Skip the root folder itself
                }
                
                let indent = "  ".repeat(depth - 1);
                let name = entry.file_name().to_string_lossy();
                let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                
                let line = if is_dir {
                    format!("{}{} /\n", indent, name)
                } else {
                    format!("{}{}\n", indent, name)
                };
                
                // Limit the size of the tree string to avoid blowing up the LLM context window
                // Keeping it under 4000 bytes (approx 1000 tokens) to ensure it fits in a 2048 default context
                if tree_string.len() + line.len() > 4_000 {
                    tree_string.push_str(&format!("{}... (truncated due to size)\n", indent));
                    break;
                }
                
                tree_string.push_str(&line);
            }
            Err(_) => continue,
        }
    }
    
    Ok(tree_string)
}
