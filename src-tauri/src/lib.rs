pub mod activity;
pub mod airllm;
pub mod browser;
pub mod indexer;
pub mod knowledge;
pub mod llm;
pub mod mcp;
pub mod ollama;
pub mod path_security;
pub mod portfolio;
pub mod review;
pub mod sandbox;
pub mod search;
pub mod secrets;
pub mod settings;
pub mod snapshot;
pub mod structured;
pub mod telegram;
pub mod telemetry;
pub mod user_management;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            secrets::set_secret,
            secrets::delete_secret,
            secrets::get_secret_status,
            llm::chat_completion,
            activity::append_activity,
            activity::list_activity,
            activity::clear_activity,
            airllm::check_airllm_environment,
            airllm::start_airllm_server,
            airllm::stop_airllm_server,
            airllm::get_airllm_status,
            telegram::start_telegram_bot,
            telegram::stop_telegram_bot,
            telegram::send_telegram_message,
            telegram::download_telegram_file,
            telegram::send_telegram_file,
            indexer::get_workspace_tree,
            snapshot::create_snapshot,
            knowledge::build_workspace_knowledge,
            knowledge::search_workspace_knowledge,
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
            review::preview_file_change,
            settings::load_settings,
            settings::save_settings,
            settings::save_chat_session,
            settings::load_chat_session,
            settings::list_chat_sessions,
            settings::delete_chat_session,
            ollama::start_ollama_daemon,
            ollama::fetch_ollama_models,
            portfolio::export_portable_bundle,
            portfolio::import_portable_bundle,
            mcp::inspect_mcp_server,
            mcp::call_mcp_tool,
            ollama::fetch_ollama_model_details,
            search::search_web,
            browser::browse_web_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Iroh");
}
