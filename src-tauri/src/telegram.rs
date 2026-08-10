use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{command, Emitter, AppHandle};
use reqwest::Client;

use tokio::sync::Mutex;
use tauri::async_runtime::JoinHandle;

lazy_static::lazy_static! {
    static ref IS_POLLING: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
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
struct Video {
    file_id: String,
    file_name: Option<String>,
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct Audio {
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
    video: Option<Video>,
    audio: Option<Audio>,
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

#[command]
pub async fn start_telegram_bot(app_handle: AppHandle, token: String) -> Result<String, String> {
    let mut task_lock = POLLING_TASK.lock().await;
    
    if task_lock.is_some() {
        return Ok("Already polling".to_string());
    }
    
    IS_POLLING.store(true, Ordering::SeqCst);
    
    let handle = tauri::async_runtime::spawn(async move {
        let client = Client::new();
        let mut offset: i64 = 0;
        
        while IS_POLLING.load(Ordering::SeqCst) {
            let url = format!("https://api.telegram.org/bot{}/getUpdates?offset={}&timeout=30", token, offset);
            
            match client.get(&url).send().await {
                Ok(resp) => {
                    if let Ok(data) = resp.json::<GetUpdatesResponse>().await {
                        if data.ok {
                            if let Some(updates) = data.result {
                                for update in updates {
                                    offset = update.update_id + 1;
                                    if let Some(msg) = update.message {
                                        let text = msg.text.clone();
                                        let mut file_id = None;
                                        let mut file_name = None;
                                        let mut file_size = None;

                                        if let Some(doc) = &msg.document {
                                            file_id = Some(doc.file_id.clone());
                                            file_name = doc.file_name.clone();
                                            file_size = doc.file_size;
                                        } else if let Some(video) = &msg.video {
                                            file_id = Some(video.file_id.clone());
                                            file_name = video.file_name.clone();
                                            file_size = video.file_size;
                                        } else if let Some(audio) = &msg.audio {
                                            file_id = Some(audio.file_id.clone());
                                            file_name = audio.file_name.clone();
                                            file_size = audio.file_size;
                                        } else if let Some(photos) = &msg.photo {
                                            if let Some(largest) = photos.last() {
                                                file_id = Some(largest.file_id.clone());
                                                file_name = Some(format!("photo_{}.jpg", largest.file_id.chars().take(8).collect::<String>()));
                                                file_size = largest.file_size;
                                            }
                                        }

                                        if file_size.unwrap_or(0) > 5_242_880 { // 5MB limit
                                            let _ = app_handle.emit("telegram-message", TelegramEvent {
                                                chat_id: msg.chat.id,
                                                text: Some("File ignored: exceeds 5MB limit.".to_string()),
                                                file_id: None,
                                                file_name: None,
                                            });
                                            continue;
                                        }

                                        if text.is_some() || file_id.is_some() {
                                            let event = TelegramEvent {
                                                chat_id: msg.chat.id,
                                                text,
                                                file_id,
                                                file_name,
                                            };
                                            let _ = app_handle.emit("telegram-message", event);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }
    });

    *task_lock = Some(handle);
    Ok("Started Telegram polling".to_string())
}

#[command]
pub async fn stop_telegram_bot() -> Result<String, String> {
    IS_POLLING.store(false, Ordering::SeqCst);
    let mut task_lock = POLLING_TASK.lock().await;
    if let Some(handle) = task_lock.take() {
        handle.abort();
    }
    Ok("Stopped Telegram polling".to_string())
}

#[command]
pub async fn send_telegram_message(token: String, chat_id: i64, text: String) -> Result<String, String> {
    let client = Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text
    });
    
    client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    Ok("Message sent".to_string())
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
pub async fn download_telegram_file(token: String, file_id: String, file_name: String, workspace: String) -> Result<String, String> {
    let client = Client::new();
    let file_url = format!("https://api.telegram.org/bot{}/getFile?file_id={}", token, file_id);
    
    let resp = client.get(&file_url).send().await.map_err(|e| e.to_string())?;
    let data = resp.json::<FileResponse>().await.map_err(|e| e.to_string())?;
    
    if data.ok {
        if let Some(result) = data.result {
            let download_url = format!("https://api.telegram.org/file/bot{}/{}", token, result.file_path);
            let file_bytes = client.get(&download_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
            
            let workspaces: Vec<&str> = workspace.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
            let primary = workspaces.first().copied().unwrap_or("C:\\");
            let dest = std::path::Path::new(primary).join(&file_name);
            
            std::fs::write(&dest, file_bytes).map_err(|e| e.to_string())?;
            return Ok(format!("Downloaded to {}", dest.display()));
        }
    }
    Err("Failed to get file path from Telegram".to_string())
}

#[command]
pub async fn send_telegram_file(token: String, chat_id: i64, file_path: String) -> Result<String, String> {
    let client = Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendDocument", token);
    
    let file_bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let file_name = std::path::Path::new(&file_path).file_name().unwrap_or_default().to_string_lossy().to_string();
    
    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name);
        
    let form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("document", part);
        
    client.post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    Ok(format!("Sent file {}", file_path))
}
