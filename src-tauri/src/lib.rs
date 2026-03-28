mod commands;
mod models;

use commands::watcher::WatcherState;
use std::sync::Mutex;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::spec_tree::read_spec_tree,
            commands::spec_tree::create_context,
            commands::spec_tree::rename_context,
            commands::spec_tree::delete_context,
            commands::file_ops::read_file,
            commands::file_ops::write_file,
            commands::chat::read_chat,
            commands::chat::write_chat,
            commands::chat::send_chat_message,
            commands::documents::list_recent_documents,
            commands::documents::add_recent_document,
            commands::documents::remove_recent_document,
            commands::export::export_spec,
            commands::watcher::watch_directory,
            commands::watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
