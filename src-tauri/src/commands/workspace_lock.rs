use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fs2::FileExt;

/// Tracks exclusive locks for all open workspaces in this process.
/// Each workspace path maps to its lock file handle.
pub struct WorkspaceLocks(pub Mutex<HashMap<PathBuf, File>>);

const LOCK_FILE: &str = ".private/workspace.lock";

pub fn acquire(locks: &WorkspaceLocks, root_path: &str) -> Result<(), String> {
    let canonical = PathBuf::from(root_path);
    let mut guard = locks.0.lock().expect("WorkspaceLocks mutex poisoned");

    // Already open in this process — idempotent for reloads
    if guard.contains_key(&canonical) {
        return Ok(());
    }

    let lock_path = Path::new(root_path).join(LOCK_FILE);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .private directory: {e}"))?;
    }

    let file = File::create(&lock_path)
        .map_err(|e| format!("Failed to create lock file: {e}"))?;

    file.try_lock_exclusive().map_err(|_| {
        "This workspace is already open in another instance of Sigil.".to_string()
    })?;

    guard.insert(canonical, file);
    Ok(())
}

pub fn release(locks: &WorkspaceLocks, root_path: &str) {
    let canonical = PathBuf::from(root_path);
    let mut guard = locks.0.lock().expect("WorkspaceLocks mutex poisoned");
    // Dropping the File releases the OS lock
    guard.remove(&canonical);
}

pub fn is_open(locks: &WorkspaceLocks, root_path: &str) -> bool {
    let canonical = PathBuf::from(root_path);
    let guard = locks.0.lock().expect("WorkspaceLocks mutex poisoned");
    guard.contains_key(&canonical)
}

#[tauri::command]
pub fn close_workspace(state: tauri::State<'_, WorkspaceLocks>, root_path: String) {
    release(&state, &root_path);
}
