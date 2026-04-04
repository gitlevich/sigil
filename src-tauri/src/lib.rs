mod commands;
mod models;
pub mod memory;

use commands::watcher::WatcherState;
use std::sync::{Arc, Mutex};

/// Lazily-initialized memory state. Opened on first use when sigil root is known.
pub struct MemoryHandle(pub Arc<tokio::sync::Mutex<Option<memory::MemoryState>>>);

/// Channel to trigger sleep consolidation.
pub struct SleepSender(pub tokio::sync::mpsc::Sender<memory::sleeper::SleepTrigger>);

/// Receiver side of sleep trigger — taken once to start the sleep loop.
pub struct SleepRx(pub Arc<tokio::sync::Mutex<Option<tokio::sync::mpsc::Receiver<memory::sleeper::SleepTrigger>>>>);

pub fn run() {
    let memory_handle = MemoryHandle(Arc::new(tokio::sync::Mutex::new(None)));
    let (sleep_tx, sleep_rx) = tokio::sync::mpsc::channel::<memory::sleeper::SleepTrigger>(4);

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState(Mutex::new(None)))
        .manage(memory_handle)
        .manage(SleepSender(sleep_tx))
        .invoke_handler(tauri::generate_handler![
            commands::sigil::read_sigil,
            commands::sigil::create_context,
            commands::sigil::rename_context,
            commands::sigil::rename_sigil,
            commands::sigil::move_sigil,
            commands::sigil::delete_context,
            commands::file_ops::read_file,
            commands::file_ops::write_file,
            commands::file_ops::delete_file,
            commands::file_ops::reveal_in_finder,
            commands::chat::list_models,
            commands::chat::list_chats,
            commands::chat::read_chat,
            commands::chat::write_chat,
            commands::chat::delete_chat,
            commands::chat::rename_chat,
            commands::chat::send_chat_message,
            commands::chat::memory_recall_for_sigil,
            commands::chat::memory_status,
            commands::chat::memory_trigger_reindex,
            commands::chat::memory_trigger_sleep,
            commands::chat::read_memories,
            commands::documents::list_recent_documents,
            commands::documents::add_recent_document,
            commands::documents::remove_recent_document,
            commands::documents::prune_recent_documents,
            commands::export::export_sigil,
            commands::watcher::watch_directory,
            commands::watcher::stop_watching,
        ])
        .manage(SleepRx(Arc::new(tokio::sync::Mutex::new(Some(sleep_rx)))))
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
