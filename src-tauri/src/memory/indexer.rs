use std::path::Path;
use sha2::{Sha256, Digest};
use walkdir::WalkDir;

use super::{MemoryDb, MemoryError};
use super::embedder::EmbeddingProvider;

/// Maximum characters per chunk. Most sigil .md files are under this limit.
const CHUNK_SIZE: usize = 2048;
/// Overlap between chunks to preserve context at boundaries.
const CHUNK_OVERLAP: usize = 256;

/// Index the entire sigil tree. Walks all .md files, computes hashes,
/// and only re-embeds files that have changed since last index.
pub fn index_sigil_tree(
    sigil_root: &Path,
    db: &MemoryDb,
    embedder: &dyn EmbeddingProvider,
) -> Result<IndexStats, MemoryError> {
    let mut stats = IndexStats::default();

    let md_files = collect_md_files(sigil_root);
    let indexed_files = db.indexed_files()?;

    // Remove stale entries for files that no longer exist
    for indexed_path in &indexed_files {
        if !md_files.iter().any(|f| f.0 == *indexed_path) {
            db.delete_chunks_for_file(indexed_path)?;
            stats.removed += 1;
        }
    }

    // Batch texts for embedding to minimize model calls
    let mut pending: Vec<(String, usize, String)> = Vec::new(); // (file_path, chunk_index, text)

    for (file_path, content) in &md_files {
        let hash = compute_hash(content);
        let existing_hash = db.get_file_hash(file_path)?;

        if existing_hash.as_deref() == Some(&hash) {
            stats.skipped += 1;
            continue;
        }

        // File changed or new — delete old chunks, prepare new ones
        db.delete_chunks_for_file(file_path)?;
        let chunks = chunk_text(content);

        for (i, chunk_text) in chunks.iter().enumerate() {
            pending.push((file_path.clone(), i, chunk_text.clone()));
        }

        stats.file_hashes.push((file_path.clone(), hash));
    }

    // Embed in batches
    if !pending.is_empty() {
        let texts: Vec<&str> = pending.iter().map(|(_, _, t)| t.as_str()).collect();
        let embeddings = embedder.embed(&texts)?;

        for ((file_path, chunk_index, text), embedding) in pending.iter().zip(embeddings.iter()) {
            let hash = stats.file_hashes.iter()
                .find(|(p, _)| p == file_path)
                .map(|(_, h)| h.as_str())
                .unwrap_or("");
            db.upsert_chunk(file_path, *chunk_index, text, embedding, hash)?;
            stats.indexed += 1;
        }
    }

    Ok(stats)
}

/// Reindex a single file. Called when a file change is detected.
pub fn reindex_file(
    file_path: &str,
    db: &MemoryDb,
    embedder: &dyn EmbeddingProvider,
) -> Result<bool, MemoryError> {
    let path = Path::new(file_path);
    if !path.exists() {
        db.delete_chunks_for_file(file_path)?;
        return Ok(true);
    }

    let content = std::fs::read_to_string(path)?;
    let hash = compute_hash(&content);
    let existing_hash = db.get_file_hash(file_path)?;

    if existing_hash.as_deref() == Some(&hash) {
        return Ok(false);
    }

    db.delete_chunks_for_file(file_path)?;
    let chunks = chunk_text(&content);
    let texts: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
    let embeddings = embedder.embed(&texts)?;

    for (i, (text, embedding)) in chunks.iter().zip(embeddings.iter()).enumerate() {
        db.upsert_chunk(file_path, i, text, embedding, &hash)?;
    }

    Ok(true)
}

/// Collect all .md files under a sigil root, skipping .sigil/ and chats/ dirs.
fn collect_md_files(root: &Path) -> Vec<(String, String)> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip hidden dirs, .sigil, chats, node_modules (but never filter the root entry)
            if e.file_type().is_dir() && e.depth() > 0 {
                if name == ".memories" {
                    return true; // concept sigils are indexed despite dot-prefix
                }
                return !name.starts_with('.') && name != "chats" && name != "node_modules";
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(content) = std::fs::read_to_string(path) {
                if !content.trim().is_empty() {
                    files.push((path.to_string_lossy().to_string(), content));
                }
            }
        }
    }
    files
}

/// Split text into overlapping chunks.
pub fn chunk_text(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.len() <= CHUNK_SIZE {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let end = (start + CHUNK_SIZE).min(text.len());
        // Try to break at a paragraph or sentence boundary
        let chunk_end = if end < text.len() {
            find_break_point(&text[start..end])
                .map(|bp| start + bp)
                .unwrap_or(end)
        } else {
            end
        };
        chunks.push(text[start..chunk_end].trim().to_string());
        let next_start = if chunk_end > start + CHUNK_OVERLAP {
            chunk_end - CHUNK_OVERLAP
        } else {
            chunk_end
        };
        // Guard: always advance by at least 1 to prevent infinite loops
        start = next_start.max(start + 1);
    }

    chunks.into_iter().filter(|c| !c.is_empty()).collect()
}

/// Find the last paragraph break (\n\n) or sentence boundary (. ) in a chunk.
fn find_break_point(text: &str) -> Option<usize> {
    // Prefer paragraph boundaries
    if let Some(pos) = text.rfind("\n\n") {
        if pos > text.len() / 2 {
            return Some(pos + 2);
        }
    }
    // Fall back to sentence boundaries
    if let Some(pos) = text.rfind(". ") {
        if pos > text.len() / 2 {
            return Some(pos + 2);
        }
    }
    None
}

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Default)]
pub struct IndexStats {
    pub indexed: usize,
    pub skipped: usize,
    pub removed: usize,
    file_hashes: Vec<(String, String)>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_chunk_text_short() {
        let text = "Short text.";
        let chunks = chunk_text(text);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "Short text.");
    }

    #[test]
    fn test_chunk_text_long() {
        let text = "a".repeat(5000);
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 1);
        // Each chunk should be <= CHUNK_SIZE
        for chunk in &chunks {
            assert!(chunk.len() <= CHUNK_SIZE + CHUNK_OVERLAP);
        }
    }

    #[test]
    fn test_collect_md_files_skips_hidden_and_chats() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        std::fs::write(root.join("language.md"), "root lang").unwrap();
        std::fs::create_dir(root.join("Child")).unwrap();
        std::fs::write(root.join("Child/language.md"), "child lang").unwrap();

        std::fs::create_dir(root.join(".sigil")).unwrap();
        std::fs::write(root.join(".sigil/hidden.md"), "hidden").unwrap();

        std::fs::create_dir(root.join("chats")).unwrap();
        std::fs::write(root.join("chats/chat.md"), "chat").unwrap();

        let files = collect_md_files(root);
        let paths: Vec<String> = files.iter().map(|(p, _)| p.clone()).collect();
        assert!(paths.iter().any(|p| p.ends_with("language.md")), "Expected language.md in {:?}", paths);
        assert!(!paths.iter().any(|p| p.contains(".sigil")));
        assert!(!paths.iter().any(|p| p.contains("/chats/")));
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = compute_hash("hello");
        let h2 = compute_hash("hello");
        assert_eq!(h1, h2);
        let h3 = compute_hash("world");
        assert_ne!(h1, h3);
    }
}
