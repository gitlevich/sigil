use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::models::sigil::RecentDocument;

fn recent_docs_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    if !app_data.exists() {
        fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    }
    Ok(app_data.join("recent_documents.json"))
}

#[tauri::command]
pub fn list_recent_documents(app: tauri::AppHandle) -> Result<Vec<RecentDocument>, String> {
    let path = recent_docs_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_recent_document(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = list_recent_documents(app.clone()).unwrap_or_default();

    docs.retain(|d| d.path != path);

    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    docs.insert(0, RecentDocument {
        name,
        path,
        last_opened: now,
    });

    if docs.len() > 20 {
        docs.truncate(20);
    }

    let content = serde_json::to_string_pretty(&docs).map_err(|e| e.to_string())?;
    fs::write(&docs_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_recent_document(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = list_recent_documents(app).unwrap_or_default();
    docs.retain(|d| d.path != path);
    let content = serde_json::to_string_pretty(&docs).map_err(|e| e.to_string())?;
    fs::write(&docs_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prune_recent_documents(app: tauri::AppHandle) -> Result<Vec<RecentDocument>, String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = list_recent_documents(app).unwrap_or_default();
    docs.retain(|d| Path::new(&d.path).exists());
    let content = serde_json::to_string_pretty(&docs).map_err(|e| e.to_string())?;
    fs::write(&docs_path, content).map_err(|e| e.to_string())?;
    Ok(docs)
}

use tauri::Manager;
