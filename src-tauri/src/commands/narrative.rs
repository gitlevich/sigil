//! Persistent sigil narrative.
//!
//! A narrative event is an append-only record of a sigil mutation. It stores
//! enough before/after state to reconstruct what the workspace looked like at
//! an earlier timepoint.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

const NARRATIVE_DIR: &str = ".private/narrative";
const EVENTS_FILE: &str = "events.jsonl";
const NARRATIVE_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NarrativeFileEncoding {
    Utf8,
    Base64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeFileSnapshot {
    pub relative_path: String,
    pub encoding: NarrativeFileEncoding,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeSigilSnapshot {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub files: Vec<NarrativeFileSnapshot>,
    pub children: Vec<NarrativeSigilSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeEvent {
    pub version: u8,
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub operation: String,
    pub sigil_path: String,
    pub sigil_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<NarrativeSigilSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<NarrativeSigilSnapshot>,
}

#[derive(Debug, Clone)]
pub struct PendingNarrativeChange {
    root: PathBuf,
    owner: PathBuf,
    before: Option<NarrativeSigilSnapshot>,
    file_path: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_context_dir(dir: &Path) -> bool {
    dir.join("language.md").exists() || dir.join("spec.md").exists()
}

fn sigil_name_from_dir(root: &Path, dir: &Path) -> String {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");

    if dir == root && name.to_ascii_lowercase().ends_with(".sigil") {
        name[..name.len() - ".sigil".len()].to_string()
    } else {
        name.to_string()
    }
}

fn to_forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(to_forward_slashes)
        .unwrap_or_else(|| to_forward_slashes(path))
}

fn narrative_file(root: &Path) -> PathBuf {
    root.join(NARRATIVE_DIR).join(EVENTS_FILE)
}

fn ensure_narrative_dir(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join(NARRATIVE_DIR)).map_err(|e| e.to_string())
}

pub fn workspace_root_for_path(path: &Path) -> Option<PathBuf> {
    let mut cursor = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };
    let mut found = None;

    loop {
        if cursor.join("vision.md").is_file() && is_context_dir(&cursor) {
            found = Some(cursor.clone());
        }
        if !cursor.pop() {
            break;
        }
    }

    found
}

fn path_is_inside_workspace_private_or_libs(root: &Path, path: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(rel) => rel,
        Err(_) => return false,
    };

    rel.components().any(|component| {
        let text = component.as_os_str().to_string_lossy();
        text == "Libs" || text.starts_with('.')
    })
}

fn owning_sigil_dir(root: &Path, path: &Path) -> Option<PathBuf> {
    if path_is_inside_workspace_private_or_libs(root, path) {
        return None;
    }

    if path.is_dir() && is_context_dir(path) {
        return Some(path.to_path_buf());
    }

    let mut cursor = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };

    loop {
        if cursor.starts_with(root) && is_context_dir(&cursor) {
            return Some(cursor);
        }
        if cursor == root || !cursor.pop() {
            break;
        }
    }

    None
}

fn snapshot_file(root: &Path, path: &Path) -> Result<NarrativeFileSnapshot, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let (encoding, content) = match String::from_utf8(bytes) {
        Ok(text) => (NarrativeFileEncoding::Utf8, text),
        Err(err) => (
            NarrativeFileEncoding::Base64,
            base64::engine::general_purpose::STANDARD.encode(err.into_bytes()),
        ),
    };

    Ok(NarrativeFileSnapshot {
        relative_path: relative_path(root, path),
        encoding,
        content,
    })
}

fn snapshot_sigil(root: &Path, sigil_dir: &Path, recursive: bool) -> Result<NarrativeSigilSnapshot, String> {
    let mut files = Vec::new();
    let mut children = Vec::new();

    let mut entries: Vec<_> = fs::read_dir(sigil_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "Libs" {
            continue;
        }
        if path.is_file() {
            files.push(snapshot_file(root, &path)?);
        } else if recursive && path.is_dir() && is_context_dir(&path) {
            children.push(snapshot_sigil(root, &path, true)?);
        }
    }

    Ok(NarrativeSigilSnapshot {
        name: sigil_name_from_dir(root, sigil_dir),
        path: sigil_dir.to_string_lossy().to_string(),
        relative_path: relative_path(root, sigil_dir),
        files,
        children,
    })
}

fn flatten_snapshot(snapshot: &NarrativeSigilSnapshot, out: &mut Vec<NarrativeSigilSnapshot>) {
    let mut current = snapshot.clone();
    current.children = Vec::new();
    out.push(current);
    for child in &snapshot.children {
        flatten_snapshot(child, out);
    }
}

fn flattened_paths(snapshot: &NarrativeSigilSnapshot) -> BTreeSet<String> {
    let mut snapshots = Vec::new();
    flatten_snapshot(snapshot, &mut snapshots);
    snapshots.into_iter().map(|snapshot| snapshot.relative_path).collect()
}

fn next_sequence(root: &Path) -> Result<u64, String> {
    let file = narrative_file(root);
    if !file.exists() {
        return Ok(1);
    }
    let reader = fs::File::open(file).map_err(|e| e.to_string())?;
    Ok(std::io::BufReader::new(reader).lines().count() as u64 + 1)
}

fn append_event(
    root: &Path,
    operation: &str,
    file_path: Option<String>,
    before: Option<NarrativeSigilSnapshot>,
    after: Option<NarrativeSigilSnapshot>,
) -> Result<(), String> {
    if before == after {
        return Ok(());
    }

    let anchor = after.as_ref().or(before.as_ref());
    let Some(anchor) = anchor else {
        return Ok(());
    };

    ensure_narrative_dir(root)?;
    let event = NarrativeEvent {
        version: NARRATIVE_VERSION,
        sequence: next_sequence(root)?,
        timestamp_ms: now_ms(),
        operation: operation.to_string(),
        sigil_path: anchor.relative_path.clone(),
        sigil_name: anchor.name.clone(),
        file_path,
        before,
        after,
    };

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(narrative_file(root))
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

pub fn begin_file_change(path: &Path) -> Option<PendingNarrativeChange> {
    let root = workspace_root_for_path(path)?;
    let owner = owning_sigil_dir(&root, path)?;
    let before = if owner.exists() {
        snapshot_sigil(&root, &owner, false).ok()
    } else {
        None
    };
    Some(PendingNarrativeChange {
        file_path: Some(relative_path(&root, path)),
        root,
        owner,
        before,
    })
}

impl PendingNarrativeChange {
    pub fn finish(self, operation: &str) -> Result<(), String> {
        let after = if self.owner.exists() {
            Some(snapshot_sigil(&self.root, &self.owner, false)?)
        } else {
            None
        };
        append_event(&self.root, operation, self.file_path, self.before, after)
    }
}

pub fn write_text_file(path: &Path, content: &str, operation: &str) -> Result<(), String> {
    let pending = begin_file_change(path);
    fs::write(path, content).map_err(|e| e.to_string())?;
    if let Some(pending) = pending {
        pending.finish(operation)?;
    }
    Ok(())
}

pub fn record_created_sigil(path: &Path) -> Result<(), String> {
    let Some(root) = workspace_root_for_path(path) else {
        return Ok(());
    };
    if path_is_inside_workspace_private_or_libs(&root, path) || !is_context_dir(path) {
        return Ok(());
    }
    let after = snapshot_sigil(&root, path, true)?;
    append_event(&root, "create-sigil", None, None, Some(after))
}

pub fn record_renamed_sigil(root: &Path, before: NarrativeSigilSnapshot, new_path: &Path) -> Result<(), String> {
    let after = snapshot_sigil(root, new_path, true)?;
    append_event(root, "rename-sigil", None, Some(before), Some(after))
}

pub fn record_moved_sigil(root: &Path, before: NarrativeSigilSnapshot, new_path: &Path) -> Result<(), String> {
    let after = snapshot_sigil(root, new_path, true)?;
    append_event(root, "move-sigil", None, Some(before), Some(after))
}

pub fn record_deleted_sigil(path: &Path) -> Result<(), String> {
    let Some(root) = workspace_root_for_path(path) else {
        return Ok(());
    };
    if path_is_inside_workspace_private_or_libs(&root, path) || !is_context_dir(path) {
        return Ok(());
    }
    let before = snapshot_sigil(&root, path, true)?;
    append_event(&root, "delete-sigil", None, Some(before), None)
}

pub fn snapshot_sigil_tree(root: &Path, path: &Path) -> Result<NarrativeSigilSnapshot, String> {
    snapshot_sigil(root, path, true)
}

pub fn ensure_workspace_baseline(root_path: &str) -> Result<(), String> {
    let root = Path::new(root_path);
    if !root.exists() || !is_context_dir(root) {
        return Ok(());
    }
    let events = narrative_file(root);
    if events.exists() {
        return Ok(());
    }
    let after = snapshot_sigil(root, root, true)?;
    append_event(root, "baseline", None, None, Some(after))
}

fn read_events_from_root(root: &Path) -> Result<Vec<NarrativeEvent>, String> {
    let file = narrative_file(root);
    if !file.exists() {
        return Ok(Vec::new());
    }
    let reader = fs::File::open(file).map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    for line in std::io::BufReader::new(reader).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let event: NarrativeEvent = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        events.push(event);
    }
    events.sort_by_key(|event| event.sequence);
    Ok(events)
}

#[tauri::command]
pub fn list_narrative(root_path: String) -> Result<Vec<NarrativeEvent>, String> {
    read_events_from_root(Path::new(&root_path))
}

fn parent_relative_path(relative_path: &str) -> Option<String> {
    if relative_path.is_empty() {
        return None;
    }
    relative_path
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .or_else(|| Some(String::new()))
}

fn assemble_tree(
    relative_path: &str,
    states: &BTreeMap<String, NarrativeSigilSnapshot>,
) -> Option<NarrativeSigilSnapshot> {
    let mut root = states.get(relative_path)?.clone();
    let mut child_paths: Vec<String> = states
        .keys()
        .filter(|candidate| parent_relative_path(candidate).as_deref() == Some(relative_path))
        .cloned()
        .collect();
    child_paths.sort();
    root.children = child_paths
        .into_iter()
        .filter_map(|child_path| assemble_tree(&child_path, states))
        .collect();
    Some(root)
}

fn reconstruct_from_events(
    events: &[NarrativeEvent],
    timestamp_ms: u64,
) -> Option<NarrativeSigilSnapshot> {
    let mut states: BTreeMap<String, NarrativeSigilSnapshot> = BTreeMap::new();

    for event in events.iter().filter(|event| event.timestamp_ms <= timestamp_ms) {
        if matches!(event.operation.as_str(), "delete-sigil" | "rename-sigil" | "move-sigil") {
            if let Some(before) = &event.before {
                for path in flattened_paths(before) {
                    states.remove(&path);
                }
            }
        }

        match &event.after {
            Some(after) => {
                let mut flattened = Vec::new();
                flatten_snapshot(after, &mut flattened);
                for mut snapshot in flattened {
                    snapshot.children = Vec::new();
                    states.insert(snapshot.relative_path.clone(), snapshot);
                }
            }
            None => {
                if let Some(before) = &event.before {
                    for path in flattened_paths(before) {
                        states.remove(&path);
                    }
                }
            }
        }
    }

    assemble_tree("", &states)
}

#[tauri::command]
pub fn reconstruct_workspace_at(
    root_path: String,
    timestamp_ms: u64,
) -> Result<Option<NarrativeSigilSnapshot>, String> {
    let events = read_events_from_root(Path::new(&root_path))?;
    Ok(reconstruct_from_events(&events, timestamp_ms))
}

fn find_snapshot<'a>(
    snapshot: &'a NarrativeSigilSnapshot,
    relative_path: &str,
) -> Option<&'a NarrativeSigilSnapshot> {
    if snapshot.relative_path == relative_path {
        return Some(snapshot);
    }
    snapshot
        .children
        .iter()
        .find_map(|child| find_snapshot(child, relative_path))
}

#[tauri::command]
pub fn reconstruct_sigil_at(
    root_path: String,
    path: String,
    timestamp_ms: u64,
) -> Result<Option<NarrativeSigilSnapshot>, String> {
    let root = Path::new(&root_path);
    let target = Path::new(&path);
    let rel = if target == root {
        String::new()
    } else {
        relative_path(root, target)
    };
    let Some(workspace) = reconstruct_workspace_at(root_path, timestamp_ms)? else {
        return Ok(None);
    };
    Ok(find_snapshot(&workspace, &rel).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_workspace() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Story.sigil");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "vision").unwrap();
        fs::write(root.join("language.md"), "before").unwrap();
        (tmp, root)
    }

    fn file_content(snapshot: &NarrativeSigilSnapshot, rel: &str) -> String {
        snapshot
            .files
            .iter()
            .find(|file| file.relative_path == rel)
            .map(|file| file.content.clone())
            .unwrap()
    }

    #[test]
    fn reconstructs_file_write_at_timepoint() {
        let (_tmp, root) = setup_workspace();
        ensure_workspace_baseline(&root.to_string_lossy()).unwrap();
        let baseline_time = list_narrative(root.to_string_lossy().to_string()).unwrap()[0].timestamp_ms;

        std::thread::sleep(std::time::Duration::from_millis(2));
        write_text_file(&root.join("language.md"), "after", "write-file").unwrap();
        let events = list_narrative(root.to_string_lossy().to_string()).unwrap();
        let write_time = events.last().unwrap().timestamp_ms;

        let before = reconstruct_workspace_at(root.to_string_lossy().to_string(), baseline_time)
            .unwrap()
            .unwrap();
        let after = reconstruct_workspace_at(root.to_string_lossy().to_string(), write_time)
            .unwrap()
            .unwrap();

        assert_eq!(file_content(&before, "language.md"), "before");
        assert_eq!(file_content(&after, "language.md"), "after");
    }

    #[test]
    fn reconstructs_deleted_sigil_before_deletion() {
        let (_tmp, root) = setup_workspace();
        let child = root.join("Child");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("language.md"), "child language").unwrap();
        ensure_workspace_baseline(&root.to_string_lossy()).unwrap();
        let baseline_time = list_narrative(root.to_string_lossy().to_string()).unwrap()[0].timestamp_ms;

        std::thread::sleep(std::time::Duration::from_millis(2));
        record_deleted_sigil(&child).unwrap();
        fs::remove_dir_all(&child).unwrap();
        let deleted_time = list_narrative(root.to_string_lossy().to_string())
            .unwrap()
            .last()
            .unwrap()
            .timestamp_ms;

        let before = reconstruct_sigil_at(
            root.to_string_lossy().to_string(),
            child.to_string_lossy().to_string(),
            baseline_time,
        )
        .unwrap();
        let after = reconstruct_sigil_at(
            root.to_string_lossy().to_string(),
            child.to_string_lossy().to_string(),
            deleted_time,
        )
        .unwrap();

        assert!(before.is_some());
        assert!(after.is_none());
    }

    #[test]
    fn ignores_private_and_libs_paths() {
        let (_tmp, root) = setup_workspace();
        let private_file = root.join(".private/narrative-note.md");
        fs::create_dir_all(private_file.parent().unwrap()).unwrap();
        fs::write(&private_file, "hidden").unwrap();

        assert!(begin_file_change(&private_file).is_none());
    }
}
