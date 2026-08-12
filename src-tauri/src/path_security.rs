use std::path::{Component, Path, PathBuf};

const APP_DIR: &str = ".antigravity";
const WORKSPACE_MARKER: &str = "workspace.json";

fn normalize_for_compare(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('/', "\\").to_lowercase();
    while value.ends_with('\\') {
        value.pop();
    }
    value
}

fn path_is_within(target: &Path, root: &Path) -> bool {
    let target = normalize_for_compare(target);
    let root = normalize_for_compare(root);
    target == root || target.starts_with(&format!("{}\\", root))
}

fn parse_workspace_values(workspace: &str) -> Result<Vec<PathBuf>, String> {
    let values: Vec<PathBuf> = workspace
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect();

    if values.is_empty() {
        return Err("No workspace is configured.".to_string());
    }

    Ok(values)
}

fn reject_dangerous_root(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!(
            "Workspace path must be absolute: {}",
            path.display()
        ));
    }

    if path.parent().is_none() {
        return Err("A drive or filesystem root cannot be used as a workspace.".to_string());
    }

    let component_count = path
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();
    if component_count == 0 {
        return Err("A filesystem root cannot be used as a workspace.".to_string());
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile_path = PathBuf::from(profile);
        if normalize_for_compare(path) == normalize_for_compare(&profile_path) {
            return Err("The user profile root cannot be used as a workspace.".to_string());
        }
    }

    if let Ok(windows_dir) = std::env::var("WINDIR") {
        let windows_path = PathBuf::from(windows_dir);
        if path_is_within(path, &windows_path) || path_is_within(&windows_path, path) {
            return Err("The Windows directory cannot be used as a workspace.".to_string());
        }
    }

    Ok(())
}

pub fn workspace_candidates(workspace: &str) -> Result<Vec<PathBuf>, String> {
    let values = parse_workspace_values(workspace)?;
    for value in &values {
        reject_dangerous_root(value)?;
    }
    Ok(values)
}

pub fn canonical_workspaces(workspace: &str) -> Result<Vec<PathBuf>, String> {
    workspace_candidates(workspace)?
        .into_iter()
        .map(|path| {
            let canonical = path.canonicalize().map_err(|error| {
                format!("Workspace '{}' is unavailable: {}", path.display(), error)
            })?;
            if !canonical.is_dir() {
                return Err(format!(
                    "Workspace '{}' is not a directory.",
                    canonical.display()
                ));
            }
            Ok(canonical)
        })
        .collect()
}

pub fn primary_workspace(workspace: &str) -> Result<PathBuf, String> {
    canonical_workspaces(workspace)?
        .into_iter()
        .next()
        .ok_or_else(|| "No workspace is configured.".to_string())
}

pub fn validate_workspace_for_initialization(path: &Path) -> Result<PathBuf, String> {
    reject_dangerous_root(path)?;

    if path.exists() {
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "Unable to resolve workspace '{}': {}",
                path.display(),
                error
            )
        })?;
        reject_dangerous_root(&canonical)?;
        if !canonical.is_dir() {
            return Err(format!(
                "Workspace '{}' is not a directory.",
                canonical.display()
            ));
        }
        Ok(canonical)
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| "Workspace path has no parent directory.".to_string())?;
        let canonical_parent = parent.canonicalize().map_err(|error| {
            format!(
                "Workspace parent '{}' is unavailable: {}",
                parent.display(),
                error
            )
        })?;
        Ok(canonical_parent.join(
            path.file_name()
                .ok_or_else(|| "Workspace path has no directory name.".to_string())?,
        ))
    }
}

pub fn ensure_existing_path(path: &str, workspace: &str) -> Result<PathBuf, String> {
    let target = Path::new(path)
        .canonicalize()
        .map_err(|error| format!("Path '{}' is unavailable: {}", path, error))?;
    let roots = canonical_workspaces(workspace)?;

    if roots.iter().any(|root| path_is_within(&target, root)) {
        Ok(target)
    } else {
        Err(format!(
            "Security block: '{}' is outside the configured workspaces.",
            path
        ))
    }
}

pub fn ensure_new_file_path(path: &str, workspace: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    let file_name = requested
        .file_name()
        .ok_or_else(|| "The destination must include a file name.".to_string())?;
    let parent = requested
        .parent()
        .ok_or_else(|| "The destination must include a parent directory.".to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        format!(
            "Destination directory '{}' is unavailable: {}",
            parent.display(),
            error
        )
    })?;
    let roots = canonical_workspaces(workspace)?;

    if !roots
        .iter()
        .any(|root| path_is_within(&canonical_parent, root))
    {
        return Err(format!(
            "Security block: '{}' is outside the configured workspaces.",
            path
        ));
    }

    let destination = canonical_parent.join(file_name);
    if destination.exists() {
        return ensure_existing_path(path, workspace);
    }
    Ok(destination)
}

pub fn safe_filename(value: &str) -> Result<String, String> {
    let name = Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The file name is invalid.".to_string())?
        .trim();

    if name.is_empty() || name == "." || name == ".." || name.contains(':') {
        return Err("The file name is invalid.".to_string());
    }

    Ok(name.to_string())
}

pub fn app_dir(workspace: &Path) -> PathBuf {
    workspace.join(APP_DIR)
}

pub fn marker_path(workspace: &Path) -> PathBuf {
    app_dir(workspace).join(WORKSPACE_MARKER)
}

pub fn validate_simple_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 96
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(format!("{} contains invalid characters.", label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_root_workspace() {
        assert!(reject_dangerous_root(Path::new("C:\\")).is_err());
    }

    #[test]
    fn strips_untrusted_filename_paths() {
        assert_eq!(
            safe_filename("..\\outside\\report.pdf").unwrap(),
            "report.pdf"
        );
        assert!(safe_filename("..").is_err());
    }

    #[test]
    fn validates_storage_identifiers() {
        assert!(validate_simple_id("chat_123-abc", "Session id").is_ok());
        assert!(validate_simple_id("../settings", "Session id").is_err());
    }
}
