use crate::path_security::primary_workspace;
use ignore::WalkBuilder;

#[tauri::command]
pub fn get_workspace_tree(workspace: String) -> Result<String, String> {
    let root = primary_workspace(&workspace)?;
    let mut tree = String::new();

    for result in WalkBuilder::new(&root)
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
        let depth = entry.depth();
        if depth == 0 {
            continue;
        }

        let indent = "  ".repeat(depth.saturating_sub(1));
        let name = entry.file_name().to_string_lossy();
        let suffix = if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            "/"
        } else {
            ""
        };
        let line = format!("{}{}{}\n", indent, name, suffix);
        if tree.len() + line.len() > 8_000 {
            tree.push_str(&format!("{}... (tree truncated)\n", indent));
            break;
        }
        tree.push_str(&line);
    }

    Ok(tree)
}
