use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
pub fn watch_directory(app: AppHandle, root_path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = app_handle.emit("fs-change", paths);
        }
    })
    .map_err(|e| e.to_string())?;

    let mut watcher = watcher;
    watcher
        .watch(std::path::Path::new(&root_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_watching(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
