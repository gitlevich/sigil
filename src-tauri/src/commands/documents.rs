use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::models::sigil::RecentDocument;

fn recent_docs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    if !app_data.exists() {
        fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    }
    Ok(app_data.join("recent_documents.json"))
}

// --- Pure logic extracted for testability ---

fn load_docs(docs_path: &Path) -> Vec<RecentDocument> {
    if !docs_path.exists() {
        return Vec::new();
    }
    fs::read_to_string(docs_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_docs(docs_path: &Path, docs: &[RecentDocument]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(docs).map_err(|e| e.to_string())?;
    fs::write(docs_path, content).map_err(|e| e.to_string())
}

fn add_doc(docs: &mut Vec<RecentDocument>, path: String, timestamp: u64) {
    docs.retain(|d| d.path != path);
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    docs.insert(0, RecentDocument {
        name,
        path,
        last_opened: timestamp,
    });
    if docs.len() > 20 {
        docs.truncate(20);
    }
}

fn remove_doc(docs: &mut Vec<RecentDocument>, path: &str) {
    docs.retain(|d| d.path != path);
}

fn prune_docs(docs: &mut Vec<RecentDocument>) {
    docs.retain(|d| Path::new(&d.path).exists());
}

// --- Tauri commands ---

#[tauri::command]
pub fn list_recent_documents(app: tauri::AppHandle) -> Result<Vec<RecentDocument>, String> {
    let path = recent_docs_path(&app)?;
    Ok(load_docs(&path))
}

#[tauri::command]
pub fn add_recent_document(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = load_docs(&docs_path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    add_doc(&mut docs, path, now);
    save_docs(&docs_path, &docs)
}

#[tauri::command]
pub fn remove_recent_document(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = load_docs(&docs_path);
    remove_doc(&mut docs, &path);
    save_docs(&docs_path, &docs)
}

#[tauri::command]
pub fn prune_recent_documents(app: tauri::AppHandle) -> Result<Vec<RecentDocument>, String> {
    let docs_path = recent_docs_path(&app)?;
    let mut docs = load_docs(&docs_path);
    prune_docs(&mut docs);
    save_docs(&docs_path, &docs)?;
    Ok(docs)
}

use tauri::Manager;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn doc(name: &str, path: &str, ts: u64) -> RecentDocument {
        RecentDocument { name: name.to_string(), path: path.to_string(), last_opened: ts }
    }

    #[test]
    fn load_docs_empty_when_missing() {
        let tmp = TempDir::new().unwrap();
        let docs = load_docs(&tmp.path().join("nonexistent.json"));
        assert!(docs.is_empty());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("docs.json");
        let docs = vec![doc("A", "/a", 100)];
        save_docs(&path, &docs).unwrap();
        let loaded = load_docs(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "A");
    }

    #[test]
    fn add_doc_deduplicates() {
        let mut docs = vec![doc("A", "/a", 100), doc("B", "/b", 90)];
        add_doc(&mut docs, "/a".to_string(), 200);
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].path, "/a");
        assert_eq!(docs[0].last_opened, 200);
    }

    #[test]
    fn add_doc_inserts_at_front() {
        let mut docs = vec![doc("A", "/a", 100)];
        add_doc(&mut docs, "/b".to_string(), 200);
        assert_eq!(docs[0].path, "/b");
        assert_eq!(docs[1].path, "/a");
    }

    #[test]
    fn add_doc_extracts_name_from_path() {
        let mut docs = Vec::new();
        add_doc(&mut docs, "/Users/vlad/Projects/MySigil".to_string(), 100);
        assert_eq!(docs[0].name, "MySigil");
    }

    #[test]
    fn add_doc_truncates_at_20() {
        let mut docs: Vec<RecentDocument> = (0..20)
            .map(|i| doc(&format!("D{}", i), &format!("/{}", i), i as u64))
            .collect();
        add_doc(&mut docs, "/new".to_string(), 999);
        assert_eq!(docs.len(), 20);
        assert_eq!(docs[0].path, "/new");
    }

    #[test]
    fn remove_doc_filters_path() {
        let mut docs = vec![doc("A", "/a", 1), doc("B", "/b", 2)];
        remove_doc(&mut docs, "/a");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].path, "/b");
    }

    #[test]
    fn remove_doc_noop_when_missing() {
        let mut docs = vec![doc("A", "/a", 1)];
        remove_doc(&mut docs, "/nonexistent");
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn prune_docs_removes_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let existing = tmp.path().join("exists");
        fs::write(&existing, "").unwrap();
        let mut docs = vec![
            doc("Exists", &existing.to_string_lossy(), 1),
            doc("Gone", "/nonexistent/path", 2),
        ];
        prune_docs(&mut docs);
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "Exists");
    }
}
