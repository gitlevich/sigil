use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::models::settings::{AiProfile, AiProvider};
use super::{MemoryState, MemoryError};
use super::embedder::cosine_similarity;

/// How often the proactive sleep fires (for the user's benefit).
const SLEEP_INTERVAL: Duration = Duration::from_secs(45 * 60);

/// Known sub-sigils that are NOT concept sigils (skip during scans).
const STRUCTURAL_DIRS: &[&str] = &[
    "ContrastIndex", "Entanglement", "Experience", "Sleep",
];

/// Find DesignPartner/.memories directory by walking the sigil tree.
fn find_memories_dir(sigil_root: &Path) -> Option<std::path::PathBuf> {
    for entry in walkdir::WalkDir::new(sigil_root).max_depth(6).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() && entry.file_name() == "DesignPartner" {
            let memories = entry.path().join(".memories");
            return Some(memories);
        }
    }
    None
}

/// Cosine similarity threshold for merging related concepts.
const MERGE_THRESHOLD: f32 = 0.92;

/// Minimum weight to survive pruning.
const NOISE_FLOOR: f32 = 0.1;

/// Weight decay applied to concepts older than 24 hours during sleep.
const DECAY_FACTOR: f32 = 0.8;

/// Run the sleep loop. Fires every 45 minutes or on early trigger.
pub async fn sleep_loop(
    memory_handle: Arc<tokio::sync::Mutex<Option<MemoryState>>>,
    mut early_trigger: tokio::sync::mpsc::Receiver<()>,
) {
    let mut interval = tokio::time::interval(SLEEP_INTERVAL);
    // Skip the initial immediate tick
    interval.tick().await;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                log_sleep("Proactive sleep triggered (45min interval)");
            }
            Some(()) = early_trigger.recv() => {
                log_sleep("Early sleep triggered (context pressure)");
            }
        }

        let guard = memory_handle.lock().await;
        if let Some(ref state) = *guard {
            let profile = AiProfile {
                id: String::new(),
                name: String::new(),
                provider: AiProvider::Anthropic,
                api_key: String::new(),
                model: String::new(),
            };
            if let Err(e) = consolidate(state, &profile).await {
                eprintln!("[memory:sleep] Consolidation error: {}", e);
            }
        } else {
            log_sleep("Memory not initialized yet, skipping");
        }
    }
}

fn log_sleep(msg: &str) {
    eprintln!("[memory:sleep] {}", msg);
}

/// Consolidate memory: decay weights, prune below noise floor, merge near-duplicates.
pub async fn consolidate(
    state: &MemoryState,
    _profile: &AiProfile,
) -> Result<ConsolidationStats, MemoryError> {
    let sigil_root = state.sigil_root().await
        .ok_or(MemoryError::NotInitialized)?;

    let memory_dir = find_memories_dir(&sigil_root)
        .unwrap_or_else(|| sigil_root.join(".sigil").join("memory"));

    if !memory_dir.exists() {
        return Ok(ConsolidationStats::default());
    }

    let mut stats = ConsolidationStats::default();

    // Collect all concept sigils and their embeddings
    let mut concepts = collect_concepts(&memory_dir, state)?;

    // Apply weight decay to older concepts
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let day_seconds: i64 = 86400;

    for concept in &mut concepts {
        if now - concept.indexed_at > day_seconds {
            concept.weight *= DECAY_FACTOR;
            stats.decayed += 1;
        }
    }

    // Prune concepts below noise floor
    let mut to_delete: Vec<String> = Vec::new();
    concepts.retain(|c| {
        if c.weight < NOISE_FLOOR {
            to_delete.push(c.dir_path.clone());
            false
        } else {
            true
        }
    });

    for dir_path in &to_delete {
        let dir = Path::new(dir_path);
        if dir.exists() {
            let language_path = dir.join("language.md");
            let lang_str = language_path.to_string_lossy().to_string();
            state.db.delete_chunks_for_file(&lang_str)?;
            let _ = fs::remove_dir_all(dir);
            stats.pruned += 1;
        }
    }

    // Merge near-duplicate concepts
    let merged = find_merge_candidates(&concepts);
    for (keep_idx, merge_idx) in &merged {
        let keep = &concepts[*keep_idx];
        let merge = &concepts[*merge_idx];

        // Append merged text to the keeper's language
        let keep_language_path = Path::new(&keep.dir_path).join("language.md");
        let merged_text = format!("{}\n\n{}", keep.text, merge.text);
        let _ = fs::write(&keep_language_path, &merged_text);

        // Remove the merged concept directory
        let merge_dir = Path::new(&merge.dir_path);
        let merge_lang = merge_dir.join("language.md");
        let merge_lang_str = merge_lang.to_string_lossy().to_string();
        state.db.delete_chunks_for_file(&merge_lang_str)?;
        let _ = fs::remove_dir_all(merge_dir);
        stats.merged += 1;
    }

    // Update last_sleep timestamp
    state.db.set_meta("last_sleep_at", &now.to_string())?;

    Ok(stats)
}

struct ConceptEntry {
    dir_path: String,
    text: String,
    embedding: Vec<f32>,
    indexed_at: i64,
    weight: f32,
}

fn collect_concepts(memory_dir: &Path, state: &MemoryState) -> Result<Vec<ConceptEntry>, MemoryError> {
    let mut concepts = Vec::new();

    for entry in fs::read_dir(memory_dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if STRUCTURAL_DIRS.contains(&name.as_str()) {
            continue;
        }

        let language_path = path.join("language.md");
        if !language_path.exists() {
            continue;
        }

        let text = fs::read_to_string(&language_path).unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }

        let embeddings = state.embedder.embed(&[text.as_str()])?;
        let embedding = embeddings.into_iter().next().unwrap_or_default();

        let indexed_at = {
            let neighbors = state.db.nearest_neighbors(&embedding, 1)?;
            neighbors.first().map(|n| n.chunk.indexed_at).unwrap_or(0)
        };

        concepts.push(ConceptEntry {
            dir_path: path.to_string_lossy().to_string(),
            text,
            embedding,
            indexed_at,
            weight: 1.0,
        });
    }

    Ok(concepts)
}

/// Find pairs of concepts similar enough to merge. Returns (keep_idx, merge_idx) pairs.
fn find_merge_candidates(concepts: &[ConceptEntry]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut merged_indices = std::collections::HashSet::new();

    for i in 0..concepts.len() {
        if merged_indices.contains(&i) {
            continue;
        }
        for j in (i + 1)..concepts.len() {
            if merged_indices.contains(&j) {
                continue;
            }
            let sim = cosine_similarity(&concepts[i].embedding, &concepts[j].embedding);
            if sim > MERGE_THRESHOLD {
                // Keep the longer (more detailed) concept
                let (keep, merge) = if concepts[i].text.len() >= concepts[j].text.len() {
                    (i, j)
                } else {
                    (j, i)
                };
                pairs.push((keep, merge));
                merged_indices.insert(merge);
            }
        }
    }

    pairs
}

#[derive(Debug, Default)]
pub struct ConsolidationStats {
    pub decayed: usize,
    pub pruned: usize,
    pub merged: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_merge_candidates() {
        let concepts = vec![
            ConceptEntry {
                dir_path: "Memory/Vlad".to_string(),
                text: "The user".to_string(),
                embedding: vec![1.0, 0.0, 0.0],
                indexed_at: 0,
                weight: 1.0,
            },
            ConceptEntry {
                dir_path: "Memory/TheUser".to_string(),
                text: "The user, longer description".to_string(),
                embedding: vec![0.99, 0.01, 0.0], // Very similar to Vlad
                indexed_at: 0,
                weight: 1.0,
            },
            ConceptEntry {
                dir_path: "Memory/SanFrancisco".to_string(),
                text: "A city".to_string(),
                embedding: vec![0.0, 1.0, 0.0], // Very different
                indexed_at: 0,
                weight: 1.0,
            },
        ];

        let pairs = find_merge_candidates(&concepts);
        assert_eq!(pairs.len(), 1);
        // TheUser is longer, so it should be kept
        assert_eq!(pairs[0], (1, 0));
    }
}
