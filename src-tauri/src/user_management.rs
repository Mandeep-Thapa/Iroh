use crate::path_security::validate_simple_id;
use crate::secrets::load_secret;
use std::process::Command;
use tauri::{command, AppHandle};

fn validate_worker_username(username: &str) -> Result<(), String> {
    validate_simple_id(username, "Worker username")?;
    if username.len() > 32 || !(username == "AI_Worker" || username.starts_with("AI_Worker_")) {
        return Err(
            "Worker accounts must be named AI_Worker or start with AI_Worker_.".to_string(),
        );
    }
    Ok(())
}

fn user_is_administrator(username: &str) -> bool {
    let Ok(output) = Command::new("net")
        .args(["localgroup", "Administrators"])
        .output()
    else {
        return false;
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case(username))
}

#[command]
pub fn check_user_exists(username: &str) -> bool {
    if validate_worker_username(username).is_err() {
        return false;
    }

    Command::new("net")
        .args(["user", username])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[command]
pub fn create_user(app: AppHandle, username: &str) -> Result<String, String> {
    validate_worker_username(username)?;

    if check_user_exists(username) {
        if user_is_administrator(username) {
            return Err(
                "The configured worker account is an administrator and cannot be used.".to_string(),
            );
        }
        return Ok(format!(
            "Restricted worker account {} already exists.",
            username
        ));
    }

    let password = load_secret(&app, "worker_password")?
        .ok_or_else(|| "Worker password is not configured.".to_string())?;
    let output = Command::new("net")
        .args([
            "user",
            username,
            &password,
            "/add",
            "/expires:never",
            "/passwordchg:no",
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    if user_is_administrator(username) {
        return Err(
            "Worker account creation produced an unsafe administrator account.".to_string(),
        );
    }

    Ok(format!(
        "Created non-administrator worker account {}.",
        username
    ))
}
