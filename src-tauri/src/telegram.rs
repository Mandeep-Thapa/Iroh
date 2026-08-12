use crate::path_security::{ensure_existing_path, primary_workspace, safe_filename};
use crate::secrets::load_secret;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tauri::async_runtime::JoinHandle;
use tauri::{command, AppHandle, Emitter};
use tokio::sync::Mutex;

const MAX_TELEGRAM_FILE_BYTES: u64 = 5 * 1024 * 1024;

lazy_static::lazy_static! {
    static ref IS_POLLING: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    static ref AUTHORIZED_CHAT_ID: AtomicI64 = AtomicI64::new(0);
    static ref POLLING_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
}

#[derive(Deserialize)]
struct Update {
    update_id: i64,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Document {
    file_id: String,
    file_name: Option<String>,
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct PhotoSize {
    file_id: String,
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct Media {
    file_id: String,
    file_name: Option<String>,
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct Message {
    chat: Chat,
    text: Option<String>,
    document: Option<Document>,
    photo: Option<Vec<PhotoSize>>,
    video: Option<Media>,
    audio: Option<Media>,
}

#[derive(Deserialize)]
struct Chat {
    id: i64,
}

#[derive(Deserialize)]
struct GetUpdatesResponse {
    ok: bool,
    result: Option<Vec<Update>>,
}

#[derive(Serialize, Clone)]
struct TelegramEvent {
    chat_id: i64,
    text: Option<String>,
    file_id: Option<String>,
    file_name: Option<String>,
}

fn authorized_chat(chat_id: i64) -> Result<(), String> {
    if chat_id > 0 && AUTHORIZED_CHAT_ID.load(Ordering::SeqCst) == chat_id {
        Ok(())
    } else {
        Err("Telegram chat is not authorized.".to_string())
    }
}

async fn telegram_token(app: &AppHandle) -> Result<String, String> {
    load_secret(app, "telegram_token")?
        .ok_or_else(|| "Telegram bot token is not configured.".to_string())
}

#[command]
pub async fn start_telegram_bot(
    app_handle: AppHandle,
    allowed_chat_id: i64,
) -> Result<String, String> {
    if allowed_chat_id <= 0 {
        return Err("A positive authorized Telegram chat ID is required.".to_string());
    }
    let token = telegram_token(&app_handle).await?;
    let mut task_lock = POLLING_TASK.lock().await;
    if task_lock.is_some() {
        return Ok("Telegram polling is already running.".to_string());
    }

    AUTHORIZED_CHAT_ID.store(allowed_chat_id, Ordering::SeqCst);
    IS_POLLING.store(true, Ordering::SeqCst);
    let handle = tauri::async_runtime::spawn(async move {
        let client = match Client::builder()
            .timeout(std::time::Duration::from_secs(40))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let mut offset = 0i64;

        while IS_POLLING.load(Ordering::SeqCst) {
            let url = format!(
                "https://api.telegram.org/bot{}/getUpdates?offset={}&timeout=30",
                token, offset
            );
            match client.get(url).send().await {
                Ok(response) => {
                    let Ok(data) = response.json::<GetUpdatesResponse>().await else {
                        continue;
                    };
                    if !data.ok {
                        continue;
                    }

                    for update in data.result.unwrap_or_default() {
                        offset = update.update_id + 1;
                        let Some(message) = update.message else {
                            continue;
                        };
                        if message.chat.id != allowed_chat_id {
                            continue;
                        }

                        let mut file_id = None;
                        let mut file_name = None;
                        let mut file_size = None;
                        if let Some(document) = &message.document {
                            file_id = Some(document.file_id.clone());
                            file_name = document.file_name.clone();
                            file_size = document.file_size;
                        } else if let Some(video) = &message.video {
                            file_id = Some(video.file_id.clone());
                            file_name = video.file_name.clone();
                            file_size = video.file_size;
                        } else if let Some(audio) = &message.audio {
                            file_id = Some(audio.file_id.clone());
                            file_name = audio.file_name.clone();
                            file_size = audio.file_size;
                        } else if let Some(photo) =
                            message.photo.as_ref().and_then(|photos| photos.last())
                        {
                            file_id = Some(photo.file_id.clone());
                            file_name = Some(format!(
                                "photo_{}.jpg",
                                photo.file_id.chars().take(8).collect::<String>()
                            ));
                            file_size = photo.file_size;
                        }

                        if file_size.unwrap_or(0) > MAX_TELEGRAM_FILE_BYTES {
                            let _ = app_handle.emit(
                                "telegram-message",
                                TelegramEvent {
                                    chat_id: message.chat.id,
                                    text: Some(
                                        "File ignored because it exceeds the 5 MB limit."
                                            .to_string(),
                                    ),
                                    file_id: None,
                                    file_name: None,
                                },
                            );
                            continue;
                        }

                        let sanitized_name = file_name.and_then(|name| safe_filename(&name).ok());
                        if message.text.is_some() || file_id.is_some() {
                            let _ = app_handle.emit(
                                "telegram-message",
                                TelegramEvent {
                                    chat_id: message.chat.id,
                                    text: message.text,
                                    file_id,
                                    file_name: sanitized_name,
                                },
                            );
                        }
                    }
                }
                Err(_) => tokio::time::sleep(tokio::time::Duration::from_secs(5)).await,
            }
        }
    });

    *task_lock = Some(handle);
    Ok("Telegram polling started for the configured chat ID.".to_string())
}

#[command]
pub async fn stop_telegram_bot() -> Result<String, String> {
    IS_POLLING.store(false, Ordering::SeqCst);
    AUTHORIZED_CHAT_ID.store(0, Ordering::SeqCst);
    let mut task_lock = POLLING_TASK.lock().await;
    if let Some(handle) = task_lock.take() {
        handle.abort();
    }
    Ok("Telegram polling stopped.".to_string())
}

#[command]
pub async fn send_telegram_message(
    app: AppHandle,
    chat_id: i64,
    text: String,
) -> Result<String, String> {
    authorized_chat(chat_id)?;
    let token = telegram_token(&app).await?;
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text.chars().take(4000).collect::<String>()
    });
    let response = Client::new()
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Telegram returned {}.", response.status()));
    }
    Ok("Message sent.".to_string())
}

#[derive(Deserialize)]
struct FileResponse {
    ok: bool,
    result: Option<FileResult>,
}

#[derive(Deserialize)]
struct FileResult {
    file_path: String,
}

#[command]
pub async fn download_telegram_file(
    app: AppHandle,
    file_id: String,
    file_name: String,
    workspace: String,
) -> Result<String, String> {
    let token = telegram_token(&app).await?;
    let client = Client::new();
    let response = client
        .get(format!(
            "https://api.telegram.org/bot{}/getFile?file_id={}",
            token,
            urlencoding::encode(&file_id)
        ))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let data = response
        .json::<FileResponse>()
        .await
        .map_err(|error| error.to_string())?;
    let remote_path = data
        .result
        .filter(|_| data.ok)
        .ok_or_else(|| "Telegram did not return a file path.".to_string())?
        .file_path;

    let response = client
        .get(format!(
            "https://api.telegram.org/file/bot{}/{}",
            token, remote_path
        ))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if let Some(length) = response.content_length() {
        if length > MAX_TELEGRAM_FILE_BYTES {
            return Err("Telegram file exceeds the 5 MB limit.".to_string());
        }
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_TELEGRAM_FILE_BYTES {
        return Err("Telegram file exceeds the 5 MB limit.".to_string());
    }

    let destination = primary_workspace(&workspace)?.join(safe_filename(&file_name)?);
    std::fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    Ok(format!("Downloaded to {}", destination.display()))
}

#[command]
pub async fn send_telegram_file(
    app: AppHandle,
    chat_id: i64,
    file_path: String,
    workspace: String,
) -> Result<String, String> {
    authorized_chat(chat_id)?;
    let token = telegram_token(&app).await?;
    let safe_path = ensure_existing_path(&file_path, &workspace)?;
    if !safe_path.is_file() {
        return Err("Telegram attachment must be a regular workspace file.".to_string());
    }
    let metadata = std::fs::metadata(&safe_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_TELEGRAM_FILE_BYTES {
        return Err("Telegram attachment exceeds the 5 MB limit.".to_string());
    }

    let file_name = safe_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Attachment file name is invalid.".to_string())?
        .to_string();
    let bytes = std::fs::read(&safe_path).map_err(|error| error.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes).file_name(file_name);
    let form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("document", part);
    let response = Client::new()
        .post(format!(
            "https://api.telegram.org/bot{}/sendDocument",
            token
        ))
        .multipart(form)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Telegram returned {}.", response.status()));
    }
    Ok(format!("Sent {}", safe_path.display()))
}
