use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use windows::core::w;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const ALLOWED_SECRET_NAMES: &[&str] = &[
    "openai_api_key",
    "anthropic_api_key",
    "telegram_token",
    "worker_password",
    "huggingface_token",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub openai_configured: bool,
    pub anthropic_configured: bool,
    pub telegram_configured: bool,
    pub worker_password_configured: bool,
    pub huggingface_configured: bool,
}

fn validate_secret_name(name: &str) -> Result<(), String> {
    if ALLOWED_SECRET_NAMES.contains(&name) {
        Ok(())
    } else {
        Err("Unknown secret name.".to_string())
    }
}

fn secret_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("secrets.dpapi.json"))
}

fn read_store(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = secret_file(app)?;
    if !path.exists() {
        return Ok(Map::new());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read secret store: {}", error))?;
    serde_json::from_str::<Map<String, Value>>(&content)
        .map_err(|error| format!("Secret store is invalid: {}", error))
}

fn write_store(app: &AppHandle, store: &Map<String, Value>) -> Result<(), String> {
    let path = secret_file(app)?;
    let temporary = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write secret store: {}", error))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to replace secret store: {}", error))?;
    }
    fs::rename(temporary, path).map_err(|error| format!("Failed to commit secret store: {}", error))
}

fn protect(secret: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: secret
            .len()
            .try_into()
            .map_err(|_| "Secret is too large.".to_string())?,
        pbData: secret.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            w!("Iroh"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows could not encrypt the secret: {}", error))?;

        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData.cast()));
        Ok(bytes)
    }
}

fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted
            .len()
            .try_into()
            .map_err(|_| "Encrypted secret is too large.".to_string())?,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows could not decrypt the secret: {}", error))?;

        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData.cast()));
        Ok(bytes)
    }
}

fn environment_name(name: &str) -> Option<&'static str> {
    match name {
        "openai_api_key" => Some("OPENAI_API_KEY"),
        "anthropic_api_key" => Some("ANTHROPIC_API_KEY"),
        "telegram_token" => Some("TELEGRAM_BOT_TOKEN"),
        "huggingface_token" => Some("HF_TOKEN"),
        _ => None,
    }
}

pub(crate) fn load_secret(app: &AppHandle, name: &str) -> Result<Option<String>, String> {
    validate_secret_name(name)?;

    if let Some(environment_name) = environment_name(name) {
        if let Ok(value) = std::env::var(environment_name) {
            if !value.trim().is_empty() {
                return Ok(Some(value));
            }
        }
    }

    let store = read_store(app)?;
    let Some(encoded) = store.get(name).and_then(Value::as_str) else {
        return Ok(None);
    };
    let encrypted = STANDARD
        .decode(encoded)
        .map_err(|error| format!("Stored secret is invalid: {}", error))?;
    let plaintext = unprotect(&encrypted)?;
    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|_| "Stored secret is not valid UTF-8.".to_string())
}

pub(crate) fn store_secret(app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
    validate_secret_name(name)?;
    if value.is_empty() {
        return Err("Secret cannot be empty.".to_string());
    }
    if value.len() > 16_384 {
        return Err("Secret is too large.".to_string());
    }

    let mut store = read_store(app)?;
    store.insert(
        name.to_string(),
        Value::String(STANDARD.encode(protect(value.as_bytes())?)),
    );
    write_store(app, &store)
}

#[tauri::command]
pub fn set_secret(app: AppHandle, name: String, value: String) -> Result<(), String> {
    store_secret(&app, &name, &value)
}

#[tauri::command]
pub fn delete_secret(app: AppHandle, name: String) -> Result<(), String> {
    validate_secret_name(&name)?;
    let mut store = read_store(&app)?;
    store.remove(&name);
    write_store(&app, &store)
}

#[tauri::command]
pub fn get_secret_status(app: AppHandle) -> Result<SecretStatus, String> {
    Ok(SecretStatus {
        openai_configured: load_secret(&app, "openai_api_key")?.is_some(),
        anthropic_configured: load_secret(&app, "anthropic_api_key")?.is_some(),
        telegram_configured: load_secret(&app, "telegram_token")?.is_some(),
        worker_password_configured: load_secret(&app, "worker_password")?.is_some(),
        huggingface_configured: load_secret(&app, "huggingface_token")?.is_some(),
    })
}
