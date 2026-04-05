use std::fs::{self, File};
use std::path::Path;
use std::sync::Mutex;

use fs2::FileExt;

/// Holds the exclusive lock file handle for the open workspace.
/// Dropping the File releases the OS-level lock automatically.
pub struct WorkspaceLock(pub Mutex<Option<File>>);

const LOCK_FILE: &str = ".private/workspace.lock";

pub fn acquire(root_path: &str) -> Result<File, String> {
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

    Ok(file)
}

pub fn release(state: &WorkspaceLock) {
    let mut guard = state.0.lock().expect("WorkspaceLock mutex poisoned");
    // Dropping the File releases the OS lock
    *guard = None;
}

#[tauri::command]
pub fn close_workspace(state: tauri::State<'_, WorkspaceLock>) {
    release(&state);
}
