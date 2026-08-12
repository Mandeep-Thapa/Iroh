use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct ProcessTelemetry {
    pub cpu_usage: f32,
    pub memory_mb: f64,
}

#[derive(Serialize, Deserialize)]
pub struct TelemetryLog {
    pub timestamp: u64,
    pub action_category: Option<String>,
    pub spawn_latency_ms: Option<u64>,
    pub sandbox_process: Option<ProcessTelemetry>,
    pub host_app: ProcessTelemetry,
}

#[tauri::command]
pub fn log_telemetry(
    app: AppHandle,
    action_category: Option<String>,
    spawn_latency_ms: Option<u64>,
    sandbox_pid: Option<u32>,
) -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_all();

    let host_pid = std::process::id();
    let host_app =
        process_telemetry(&system, (host_pid as usize).into()).unwrap_or(ProcessTelemetry {
            cpu_usage: 0.0,
            memory_mb: 0.0,
        });
    let sandbox_process =
        sandbox_pid.and_then(|pid| process_telemetry(&system, (pid as usize).into()));
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let safe_category = action_category.map(|value| {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
            .take(64)
            .collect()
    });

    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("telemetry.jsonl"))
        .map_err(|error| error.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&TelemetryLog {
            timestamp,
            action_category: safe_category,
            spawn_latency_ms,
            sandbox_process,
            host_app,
        })
        .map_err(|error| error.to_string())?
    )
    .map_err(|error| error.to_string())
}

fn process_telemetry(system: &System, pid: sysinfo::Pid) -> Option<ProcessTelemetry> {
    system.process(pid).map(|process| ProcessTelemetry {
        cpu_usage: process.cpu_usage(),
        memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
    })
}

#[derive(Serialize)]
pub struct SystemStats {
    pub ram_used_mb: f64,
    pub ram_total_mb: f64,
    pub vram_used_mb: f64,
    pub vram_total_mb: f64,
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    let mut system = System::new();
    system.refresh_memory();

    let mut vram_used_mb = 0.0;
    let mut vram_total_mb = 0.0;
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=memory.total,memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
            let parts: Vec<&str> = line.split(',').map(str::trim).collect();
            if parts.len() == 2 {
                vram_total_mb = parts[0].parse().unwrap_or(0.0);
                vram_used_mb = parts[1].parse().unwrap_or(0.0);
            }
        }
    }

    Ok(SystemStats {
        ram_used_mb: system.used_memory() as f64 / 1024.0 / 1024.0,
        ram_total_mb: system.total_memory() as f64 / 1024.0 / 1024.0,
        vram_used_mb,
        vram_total_mb,
    })
}
