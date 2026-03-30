mod commands;
mod models;

use commands::watcher::WatcherState;
use std::sync::Mutex;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::sigil::read_sigil,
            commands::sigil::create_context,
            commands::sigil::rename_context,
            commands::sigil::rename_sigil,
            commands::sigil::move_sigil,
            commands::sigil::delete_context,
            commands::file_ops::read_file,
            commands::file_ops::write_file,
            commands::file_ops::reveal_in_finder,
            commands::chat::list_models,
            commands::chat::list_chats,
            commands::chat::read_chat,
            commands::chat::write_chat,
            commands::chat::delete_chat,
            commands::chat::rename_chat,
            commands::chat::send_chat_message,
            commands::documents::list_recent_documents,
            commands::documents::add_recent_document,
            commands::documents::remove_recent_document,
            commands::documents::prune_recent_documents,
            commands::export::export_sigil,
            commands::watcher::watch_directory,
            commands::watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
