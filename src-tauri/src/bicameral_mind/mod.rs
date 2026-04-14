pub mod co_occurrence;
pub mod right_hemisphere;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, watch};
use types::*;

/// Event from file watcher indicating a spec file changed.
#[derive(Debug, Clone)]
pub enum SpecChange {
    /// File was created or modified.
    Modified(PathBuf),
    /// File was removed.
    Removed(PathBuf),
}

/// Shared state for the BicameralMind runtime.
/// Tauri commands read the current ContrastSpace via the watch receiver.
pub struct BicameralState {
    /// Send file-change events into the RightHemisphere processing loop.
    pub change_sender: mpsc::Sender<SpecChange>,
    /// Receive the latest ContrastSpace snapshot. Updated after each geometry recomputation.
    pub space_receiver: watch::Receiver<Arc<ContrastSpace>>,
}

/// Start the BicameralMind runtime.
///
/// 1. Builds initial ContrastSpace from spec files at `root`.
/// 2. Spawns a background tokio task that:
///    - Receives file-change events via mpsc channel
///    - Debounces rapid changes (200ms settle)
///    - Incrementally updates the geometry
///    - Detects disturbance (edge delta)
///    - Publishes new snapshot via watch channel
///
/// Returns a BicameralState for Tauri commands to query.
pub fn start(root: &Path) -> Result<BicameralState, BicameralError> {
    let initial_space = co_occurrence::build_contrast_space(root)?;
    let initial_arc = Arc::new(initial_space);

    let (space_tx, space_rx) = watch::channel(initial_arc.clone());
    let (change_tx, change_rx) = mpsc::channel::<SpecChange>(256);

    let root_owned = root.to_path_buf();
    tokio::spawn(async move {
        run_attention_loop(change_rx, space_tx, initial_arc, root_owned).await;
    });

    Ok(BicameralState {
        change_sender: change_tx,
        space_receiver: space_rx,
    })
}

/// The continuous attention loop. Event-driven, not polling.
/// Debounces rapid file changes, recomputes geometry, detects disturbance.
async fn run_attention_loop(
    mut change_rx: mpsc::Receiver<SpecChange>,
    space_tx: watch::Sender<Arc<ContrastSpace>>,
    initial_space: Arc<ContrastSpace>,
    _root: PathBuf,
) {
    let mut current_space = (*initial_space).clone();
    let debounce_ms = 200;

    loop {
        // Wait for first change event
        let first_change = match change_rx.recv().await {
            Some(c) => c,
            None => break, // Channel closed, shutdown
        };

        // Collect all changes within debounce window
        let mut changes = vec![first_change];
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_millis(debounce_ms);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, change_rx.recv()).await {
                Ok(Some(change)) => changes.push(change),
                _ => break,
            }
        }

        // Deduplicate: for each file, keep only the last event type
        let mut file_changes: std::collections::HashMap<PathBuf, SpecChange> =
            std::collections::HashMap::new();
        for change in changes {
            match &change {
                SpecChange::Modified(p) | SpecChange::Removed(p) => {
                    file_changes.insert(p.clone(), change);
                }
            }
        }

        // Take snapshot before updates for disturbance detection
        let old_space = current_space.clone();

        // Apply changes incrementally
        for (path, change) in &file_changes {
            match change {
                SpecChange::Removed(_) => {
                    co_occurrence::remove_file_from_space(&mut current_space, path);
                }
                SpecChange::Modified(p) => {
                    if let Ok(content) = std::fs::read_to_string(p) {
                        co_occurrence::update_file_in_space(&mut current_space, p, &content);
                    } else {
                        // File disappeared between notification and read
                        co_occurrence::remove_file_from_space(&mut current_space, path);
                    }
                }
            }
        }

        // Detect disturbance
        let disturbance = right_hemisphere::detect_disturbance(&old_space, &current_space);
        if !disturbance.is_empty() {
            let filtered =
                right_hemisphere::filter_disturbance(&disturbance, &current_space);
            if !filtered.is_empty() {
                eprintln!(
                    "BicameralMind: disturbance detected (amplitude={:.2}): {} added, {} removed, {} weight changes",
                    filtered.amplitude(),
                    filtered.added_edges.len(),
                    filtered.removed_edges.len(),
                    filtered.weight_changes.len(),
                );
                // Future: escalate through CorpusCallosum if amplitude > threshold
            }
        }

        // Publish new snapshot
        let _ = space_tx.send(Arc::new(current_space.clone()));
    }
}
