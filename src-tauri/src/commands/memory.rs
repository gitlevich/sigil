//! Long-term memory persistence.
//!
//! Storage: {app_data_dir}/memory/{workspace_hash}/long-term.json
//! Written on sleep (consolidation). Read on startup.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn workspace_hash(workspace_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    workspace_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn memory_dir(app: &AppHandle, workspace_path: &str) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data.join("memory").join(workspace_hash(workspace_path));
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Write the long-term memory snapshot. Overwrites the previous one.
#[tauri::command]
pub fn write_long_term_memory(
    app: AppHandle,
    workspace_path: String,
    json: String,
) -> Result<(), String> {
    let dir = memory_dir(&app, &workspace_path)?;
    let path = dir.join("long-term.json");
    fs::write(&path, &json).map_err(|e| e.to_string())
}

/// Read the long-term memory snapshot. Returns empty string if none exists.
#[tauri::command]
pub fn read_long_term_memory(
    app: AppHandle,
    workspace_path: String,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_data
        .join("memory")
        .join(workspace_hash(&workspace_path))
        .join("long-term.json");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
