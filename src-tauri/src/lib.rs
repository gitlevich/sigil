mod commands;
mod models;
pub mod infrastructure;

use commands::watcher::WatcherState;
use commands::workspace_lock::WorkspaceLocks;
use std::sync::Mutex;
use tauri::Manager;

/// Path received from Finder double-click before the frontend was ready.
pub struct PendingOpenPath(pub Mutex<Option<String>>);

#[tauri::command]
fn take_pending_open_path(state: tauri::State<'_, PendingOpenPath>) -> Option<String> {
    state.0.lock().expect("PendingOpenPath mutex poisoned").take()
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencoding_preserves_unreserved() {
        assert_eq!(urlencoding("hello-world_1.0/path"), "hello-world_1.0/path");
    }

    #[test]
    fn urlencoding_encodes_spaces() {
        assert_eq!(urlencoding("hello world"), "hello%20world");
    }

    #[test]
    fn urlencoding_encodes_special_chars() {
        let result = urlencoding("path with spaces & symbols=yes");
        assert!(result.contains("%20"));
        assert!(result.contains("%26")); // &
        assert!(result.contains("%3D")); // =
    }

    #[test]
    fn urlencoding_preserves_tilde() {
        assert_eq!(urlencoding("~user"), "~user");
    }

    #[test]
    fn urlencoding_empty_string() {
        assert_eq!(urlencoding(""), "");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState(Mutex::new(None)))
        .manage(WorkspaceLocks(Mutex::new(std::collections::HashMap::new())))
        .manage(PendingOpenPath(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::sigil::scaffold_sigil,
            commands::sigil::check_imported_ontologies,
            commands::sigil::install_ontologies,
            commands::sigil::read_sigil,
            commands::sigil::create_context,
            commands::sigil::rename_context,
            commands::sigil::rename_sigil,
            commands::sigil::move_sigil,
            commands::sigil::delete_context,
            commands::file_ops::read_file,
            commands::file_ops::write_file,
            commands::file_ops::delete_file,
            commands::file_ops::copy_image,
            commands::file_ops::write_image_bytes,
            commands::file_ops::read_image_base64,
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
            commands::workspace_lock::close_workspace,
            commands::experience::append_experience,
            commands::experience::list_experience_sessions,
            commands::left_hemisphere::invoke_left_hemisphere,
            commands::memory::write_long_term_memory,
            commands::memory::read_long_term_memory,
            take_pending_open_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sigil")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path_str = path.to_string_lossy().to_string();
                        // Check if this workspace is already open in this process
                        if let Some(locks) = app.try_state::<WorkspaceLocks>() {
                            if commands::workspace_lock::is_open(&locks, &path_str) {
                                continue; // Already open, skip
                            }
                        }

                        let has_windows = app.webview_windows().len() > 0;
                        if has_windows {
                            // App already running — open a new window
                            let label = format!("editor-{}", std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis());
                            let url_with_root = format!(
                                "index.html?root={}",
                                urlencoding(&path_str)
                            );
                            let _ = tauri::WebviewWindowBuilder::new(
                                app,
                                &label,
                                tauri::WebviewUrl::App(url_with_root.into()),
                            )
                            .title(path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Sigil".into()))
                            .inner_size(1200.0, 800.0)
                            .min_inner_size(800.0, 600.0)
                            .build();
                        } else {
                            // Fresh launch — store for frontend to pick up
                            if let Some(state) = app.try_state::<PendingOpenPath>() {
                                *state.0.lock().expect("PendingOpenPath poisoned") = Some(path_str);
                            }
                        }
                    }
                }
            }
        });
}
