use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct FsChangeEvent {
    pub paths: Vec<String>,
    pub kind: String,
}

fn event_kind_str(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => "other",
    }
}

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
            let payload = FsChangeEvent {
                paths,
                kind: event_kind_str(&event.kind).to_string(),
            };
            let _ = app_handle.emit("fs-change", payload);
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
