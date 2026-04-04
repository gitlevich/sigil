use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::models::settings::{AiProfile, AiProvider};
use super::{MemoryState, MemoryError};
use super::embedder::cosine_similarity;

/// How often the proactive sleep fires (for the user's benefit).
const SLEEP_INTERVAL: Duration = Duration::from_secs(45 * 60);

/// Find DesignPartner/Memory directory by walking the sigil tree.
fn find_design_partner_memory(sigil_root: &Path) -> Option<std::path::PathBuf> {
    for entry in walkdir::WalkDir::new(sigil_root).max_depth(6).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() && entry.file_name() == "Memory" {
            let parent = entry.path().parent()?;
            if parent.file_name()?.to_string_lossy() == "DesignPartner" {
                return Some(entry.path().to_path_buf());
            }
        }
    }
    None
}

/// Cosine similarity threshold for merging related facts.
const MERGE_THRESHOLD: f32 = 0.92;

/// Minimum weight to survive pruning.
const NOISE_FLOOR: f32 = 0.1;

/// Weight decay applied to facts older than 24 hours during sleep.
const DECAY_FACTOR: f32 = 0.8;

/// Run the sleep loop. Fires every 45 minutes or on early trigger.
/// Accepts the lazy MemoryHandle — skips if memory isn't initialized yet.
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
            // Use a dummy profile — consolidate doesn't call LLM currently
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

    let memory_dir = find_design_partner_memory(&sigil_root)
        .unwrap_or_else(|| sigil_root.join(".sigil").join("memory"));

    if !memory_dir.exists() {
        return Ok(ConsolidationStats::default());
    }

    let mut stats = ConsolidationStats::default();

    // Collect all fact files and their embeddings
    let mut facts = collect_facts(&memory_dir, state)?;

    // Apply weight decay to older facts
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let day_seconds: i64 = 86400;

    for fact in &mut facts {
        if now - fact.indexed_at > day_seconds {
            fact.weight *= DECAY_FACTOR;
            stats.decayed += 1;
        }
    }

    // Prune facts below noise floor
    let mut to_delete: Vec<String> = Vec::new();
    facts.retain(|f| {
        if f.weight < NOISE_FLOOR {
            to_delete.push(f.file_path.clone());
            false
        } else {
            true
        }
    });

    for path in &to_delete {
        if Path::new(path).exists() {
            let _ = fs::remove_file(path);
            state.db.delete_chunks_for_file(path)?;
            stats.pruned += 1;
        }
    }

    // Merge near-duplicate facts
    let merged = find_merge_candidates(&facts);
    for (keep_idx, merge_idx) in &merged {
        let _keep = &facts[*keep_idx];
        let merge = &facts[*merge_idx];

        // Keep the longer (more detailed) fact, delete the shorter
        let merge_path = &merge.file_path;
        if Path::new(merge_path).exists() {
            let _ = fs::remove_file(merge_path);
            state.db.delete_chunks_for_file(merge_path)?;
            stats.merged += 1;
        }
    }

    // Update last_sleep timestamp
    state.db.set_meta("last_sleep_at", &now.to_string())?;

    Ok(stats)
}

struct FactEntry {
    file_path: String,
    text: String,
    embedding: Vec<f32>,
    indexed_at: i64,
    weight: f32,
}

fn collect_facts(memory_dir: &Path, state: &MemoryState) -> Result<Vec<FactEntry>, MemoryError> {
    let mut facts = Vec::new();

    for entry in fs::read_dir(memory_dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if !name.starts_with("fact-") || !name.ends_with(".md") {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();
        let text = fs::read_to_string(&path).unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }

        // Get embedding from the index
        let embeddings = state.embedder.embed(&[text.as_str()])?;
        let embedding = embeddings.into_iter().next().unwrap_or_default();

        // Get indexed_at from DB, default to now
        let indexed_at = {
            let neighbors = state.db.nearest_neighbors(&embedding, 1)?;
            neighbors.first().map(|n| n.chunk.indexed_at).unwrap_or(0)
        };

        facts.push(FactEntry {
            file_path,
            text,
            embedding,
            indexed_at,
            weight: 1.0, // Will be decayed if old
        });
    }

    Ok(facts)
}

/// Find pairs of facts similar enough to merge. Returns (keep_idx, merge_idx) pairs.
fn find_merge_candidates(facts: &[FactEntry]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut merged_indices = std::collections::HashSet::new();

    for i in 0..facts.len() {
        if merged_indices.contains(&i) {
            continue;
        }
        for j in (i + 1)..facts.len() {
            if merged_indices.contains(&j) {
                continue;
            }
            let sim = cosine_similarity(&facts[i].embedding, &facts[j].embedding);
            if sim > MERGE_THRESHOLD {
                // Keep the longer fact
                let (keep, merge) = if facts[i].text.len() >= facts[j].text.len() {
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
        let facts = vec![
            FactEntry {
                file_path: "a.md".to_string(),
                text: "fact a".to_string(),
                embedding: vec![1.0, 0.0, 0.0],
                indexed_at: 0,
                weight: 1.0,
            },
            FactEntry {
                file_path: "b.md".to_string(),
                text: "fact b longer".to_string(),
                embedding: vec![0.99, 0.01, 0.0], // Very similar to a
                indexed_at: 0,
                weight: 1.0,
            },
            FactEntry {
                file_path: "c.md".to_string(),
                text: "fact c".to_string(),
                embedding: vec![0.0, 1.0, 0.0], // Very different
                indexed_at: 0,
                weight: 1.0,
            },
        ];

        let pairs = find_merge_candidates(&facts);
        assert_eq!(pairs.len(), 1);
        // b is longer, so it should be kept
        assert_eq!(pairs[0], (1, 0));
    }
}
