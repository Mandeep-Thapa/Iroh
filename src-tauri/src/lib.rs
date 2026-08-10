pub mod user_management;
pub mod workspace;
pub mod sandbox;
pub mod telemetry;
pub mod settings;
pub mod ollama;
pub mod indexer;
pub mod snapshot;
pub mod telegram;
pub mod search;
pub mod browser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            telegram::start_telegram_bot,
            telegram::stop_telegram_bot,
            telegram::send_telegram_message,
            telegram::download_telegram_file,
            telegram::send_telegram_file,
            indexer::get_workspace_tree,
            snapshot::create_snapshot,
            snapshot::get_latest_snapshot,
            snapshot::rollback_snapshot,
            user_management::check_user_exists,
            user_management::create_user,
            workspace::initialize_workspace,
            workspace::reset_workspace,
            workspace::copy_file_to_workspace,
            sandbox::execute_sandboxed_cmd,
            sandbox::read_file_safe,
            sandbox::write_file_safe,
            sandbox::list_dir_safe,
            sandbox::remember_safe,
            sandbox::read_knowledge_safe,
            sandbox::read_image_base64,
            sandbox::search_document,
            telemetry::log_telemetry,
            telemetry::get_system_stats,
            settings::load_settings,
            settings::save_settings,
            settings::save_chat_session,
            settings::load_chat_session,
            settings::list_chat_sessions,
            settings::delete_chat_session,
            ollama::start_ollama_daemon,
            ollama::fetch_ollama_models,
            search::search_web,
            browser::browse_web_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
