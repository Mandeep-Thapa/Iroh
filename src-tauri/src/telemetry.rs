use sysinfo::System;
use serde::{Serialize, Deserialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

#[derive(Serialize, Deserialize)]
pub struct ProcessTelemetry {
    pub cpu_usage: f32,
    pub memory_mb: f64,
}

#[derive(Serialize, Deserialize)]
pub struct TelemetryLog {
    pub timestamp: u64,
    pub command_executed: Option<String>,
    pub spawn_latency_ms: Option<u128>,
    pub sandbox_process: Option<ProcessTelemetry>,
    pub host_app: ProcessTelemetry,
}

#[command]
pub fn log_telemetry(
    workspace: &str,
    command_executed: Option<String>,
    spawn_latency_ms: Option<u64>,
    sandbox_pid: Option<u32>,
) -> Result<(), String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    
    // Get host process telemetry (Tauri app itself)
    let host_pid = std::process::id();
    let host_app = get_process_telemetry(&sys, (host_pid as usize).into())
        .unwrap_or(ProcessTelemetry { cpu_usage: 0.0, memory_mb: 0.0 });
    
    let sandbox_process = if let Some(pid) = sandbox_pid {
        get_process_telemetry(&sys, (pid as usize).into())
    } else {
        None
    };
    
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    
    let log_entry = TelemetryLog {
        timestamp,
        command_executed,
        spawn_latency_ms: spawn_latency_ms.map(|v| v as u128),
        sandbox_process,
        host_app,
    };
    
    let log_path = format!("{}\\telemetry_logs.json", workspace);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
        
    let json = serde_json::to_string(&log_entry).map_err(|e| e.to_string())?;
    writeln!(file, "{}", json).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn get_process_telemetry(sys: &System, pid: sysinfo::Pid) -> Option<ProcessTelemetry> {
    if let Some(process) = sys.process(pid) {
        Some(ProcessTelemetry {
            cpu_usage: process.cpu_usage(),
            memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
        })
    } else {
        None
    }
}

#[derive(Serialize)]
pub struct SystemStats {
    pub ram_used_mb: f64,
    pub ram_total_mb: f64,
    pub vram_used_mb: f64,
    pub vram_total_mb: f64,
}

#[command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    let mut sys = System::new();
    sys.refresh_memory();
    
    let ram_total_mb = sys.total_memory() as f64 / 1024.0 / 1024.0;
    let ram_used_mb = sys.used_memory() as f64 / 1024.0 / 1024.0;
    
    let mut vram_used_mb = 0.0;
    let mut vram_total_mb = 0.0;
    
    // Try to get nvidia GPU stats
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .args(&["--query-gpu=memory.total,memory.used", "--format=csv,noheader,nounits"])
        .output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = stdout.lines().next() {
            let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if parts.len() == 2 {
                vram_total_mb = parts[0].parse().unwrap_or(0.0);
                vram_used_mb = parts[1].parse().unwrap_or(0.0);
            }
        }
    }
    
    Ok(SystemStats {
        ram_used_mb,
        ram_total_mb,
        vram_used_mb,
        vram_total_mb,
    })
}
