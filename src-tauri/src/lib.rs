mod connection;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(connection::CancellationRegistry::default())
        .invoke_handler(tauri::generate_handler![
            connection::has_provider_key,
            connection::save_provider_key,
            connection::remove_provider_key,
            connection::list_available_models,
            connection::send_chat,
            connection::stream_chat,
            connection::cancel_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
