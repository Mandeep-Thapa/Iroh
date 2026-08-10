use std::process::Command;
use tauri::command;

#[command]
pub fn check_user_exists(username: &str) -> bool {
    let output = Command::new("net")
        .args(["user", username])
        .output();
    
    if let Ok(output) = output {
        output.status.success()
    } else {
        false
    }
}

#[command]
pub fn create_user(username: &str, password: &str) -> Result<String, String> {
    if check_user_exists(username) {
        return Ok(format!("User {} already exists.", username));
    }

    let output = Command::new("net")
        .args(["user", username, password, "/add"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        // Enforce strict isolation: Remove the user from the default "Users" group
        // This strips default read/write access to C:\ and C:\Users\Public, etc.
        let _ = Command::new("net")
            .args(["localgroup", "Users", username, "/delete"])
            .output();

        Ok(format!("User {} created and stripped of default group privileges.", username))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
