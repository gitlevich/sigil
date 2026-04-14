pub mod co_occurrence;
pub mod experience;
pub mod right_hemisphere;
pub mod types;

use std::collections::HashMap;
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
pub struct BicameralState {
    /// Send file-change events into the RightHemisphere processing loop.
    pub change_sender: mpsc::Sender<SpecChange>,
    /// Receive the latest ContrastSpace snapshot.
    pub space_receiver: watch::Receiver<Arc<ContrastSpace>>,
    /// The Experience journal. Protected by a tokio Mutex for async access.
    pub experience: tokio::sync::Mutex<experience::Experience>,
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
/// Start the BicameralMind runtime asynchronously.
/// The initial ContrastSpace build runs on a blocking thread to avoid
/// stalling the tokio runtime with synchronous file I/O.
pub async fn start(root: &Path) -> Result<BicameralState, BicameralError> {
    let root_for_build = root.to_path_buf();
    let initial_space = tokio::task::spawn_blocking(move || {
        co_occurrence::build_contrast_space(&root_for_build)
    })
    .await
    .map_err(|e| BicameralError::Parse(format!("spawn_blocking failed: {e}")))?
    ?;

    let resolver: HashMap<String, String> = {
        let names: Vec<String> = initial_space.spheres.keys().map(|k| k.as_str().to_string()).collect();
        co_occurrence::build_variant_resolver(&names)
    };

    let initial_arc = Arc::new(initial_space);
    let (space_tx, space_rx) = watch::channel(initial_arc.clone());
    let (change_tx, change_rx) = mpsc::channel::<SpecChange>(256);

    let root_owned = root.to_path_buf();
    tokio::spawn(async move {
        run_attention_loop(change_rx, space_tx, initial_arc, root_owned, resolver).await;
    });

    let journal_dir = root.join(".private/DesignPartnerState/experience");
    let exp = experience::Experience::new(journal_dir);

    Ok(BicameralState {
        change_sender: change_tx,
        space_receiver: space_rx,
        experience: tokio::sync::Mutex::new(exp),
    })
}

/// The continuous attention loop. Event-driven, not polling.
/// Debounces rapid file changes, recomputes geometry, detects disturbance.
async fn run_attention_loop(
    mut change_rx: mpsc::Receiver<SpecChange>,
    space_tx: watch::Sender<Arc<ContrastSpace>>,
    initial_space: Arc<ContrastSpace>,
    _root: PathBuf,
    resolver: HashMap<String, String>,
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
                    let p_clone = p.clone();
                    let content = tokio::task::spawn_blocking(move || {
                        std::fs::read_to_string(&p_clone)
                    })
                    .await;
                    match content {
                        Ok(Ok(text)) => {
                            co_occurrence::update_file_in_space(&mut current_space, p, &text, &resolver);
                        }
                        _ => {
                            // File disappeared between notification and read
                            co_occurrence::remove_file_from_space(&mut current_space, path);
                        }
                    }
                }
            }
        }

        // Detect disturbance
        let disturbance = right_hemisphere::detect_disturbance(&old_space, &current_space);
        if !disturbance.is_empty() {
            eprintln!(
                "BicameralMind: disturbance (amplitude={:.2}): +{} -{} ~{} edges",
                disturbance.amplitude(),
                disturbance.added_edges.len(),
                disturbance.removed_edges.len(),
                disturbance.weight_changes.len(),
            );
            // Future: escalate through CorpusCallosum if amplitude > threshold
        }

        // Publish new snapshot
        let _ = space_tx.send(Arc::new(current_space.clone()));
    }
}
