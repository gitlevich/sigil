//! Experience persistence — the append-only journal.
//!
//! Spec: DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience
//! Invariants: !complete, !append-only, !causal-ordering, !session-bounded
//!
//! Storage layout:
//!   {app_data_dir}/experience/{workspace_hash}/{session_id}.jsonl
//!
//! Each file starts with a session header line, followed by entry lines.
//! Files are only ever appended to — never modified or deleted.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Derive a stable directory name from a workspace path.
fn workspace_hash(workspace_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    workspace_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Get the experience directory for a workspace, creating it if needed.
fn experience_dir(app: &AppHandle, workspace_path: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let dir = app_data
        .join("experience")
        .join(workspace_hash(workspace_path));
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Append a line to a session's experience file.
///
/// The frontend is responsible for JSONL formatting (serializeHeader / serializeEntry).
/// This command just appends the line with a trailing newline. Append-only by design.
#[tauri::command]
pub fn append_experience(
    app: AppHandle,
    workspace_path: String,
    session_id: String,
    line: String,
) -> Result<(), String> {
    let dir = experience_dir(&app, &workspace_path)?;
    let file_path = dir.join(format!("{}.jsonl", session_id));

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| e.to_string())?;

    writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

/// List all session files for a workspace, sorted by modification time (oldest first).
/// Returns the content of each session file.
#[tauri::command]
pub fn list_experience_sessions(
    app: AppHandle,
    workspace_path: String,
) -> Result<Vec<String>, String> {
    let dir = experience_dir(&app, &workspace_path)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "jsonl")
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((modified, e.path()))
        })
        .collect();

    // !causal-ordering — oldest first
    entries.sort_by_key(|(time, _)| *time);

    let contents: Vec<String> = entries
        .into_iter()
        .filter_map(|(_, path)| fs::read_to_string(path).ok())
        .collect();

    Ok(contents)
}
