use std::path::Path;
use super::{MemoryDb, MemoryError};
use super::embedder::EmbeddingProvider;
use super::db::ScoredChunk;

/// Query the memory index and return a formatted context block for the system prompt.
pub fn recall(
    db: &MemoryDb,
    embedder: &dyn EmbeddingProvider,
    query: &str,
    top_k: usize,
) -> Result<String, MemoryError> {
    let query_vecs = embedder.embed(&[query])?;
    let query_vec = query_vecs.into_iter().next()
        .ok_or_else(|| MemoryError::Embedding("No embedding returned for query".to_string()))?;

    let results = db.nearest_neighbors(&query_vec, top_k)?;
    Ok(format_recall_block(&results))
}

/// Query and return raw scored chunks (for Tauri commands or programmatic use).
pub fn recall_chunks(
    db: &MemoryDb,
    embedder: &dyn EmbeddingProvider,
    query: &str,
    top_k: usize,
) -> Result<Vec<ScoredChunk>, MemoryError> {
    let query_vecs = embedder.embed(&[query])?;
    let query_vec = query_vecs.into_iter().next()
        .ok_or_else(|| MemoryError::Embedding("No embedding returned for query".to_string()))?;
    db.nearest_neighbors(&query_vec, top_k)
}

/// Format scored chunks into a readable context block for the system prompt.
fn format_recall_block(chunks: &[ScoredChunk]) -> String {
    if chunks.is_empty() {
        return String::new();
    }

    let mut output = String::new();
    for scored in chunks {
        let path = abbreviate_path(&scored.chunk.file_path);
        output.push_str(&format!("[{}] (relevance: {:.2})\n", path, scored.score));
        output.push_str(&scored.chunk.text);
        output.push_str("\n\n---\n\n");
    }
    output
}

/// Shorten absolute paths to relative sigil paths for readability.
/// e.g. "/Users/vlad/.../Application/Editor/language.md" → "Application/Editor/language.md"
fn abbreviate_path(path: &str) -> &str {
    // Find the sigil root marker — look for common spec directory patterns
    for marker in &["specification/", "docs/"] {
        if let Some(pos) = path.find(marker) {
            let after_marker = &path[pos + marker.len()..];
            // Skip one more segment (e.g., "sigil-editor/")
            if let Some(slash) = after_marker.find('/') {
                return &path[pos + marker.len() + slash + 1..];
            }
        }
    }
    // Fallback: just the filename and parent
    let p = Path::new(path);
    if let Some(parent) = p.parent().and_then(|p| p.file_name()) {
        if let Some(name) = p.file_name() {
            // Can't easily return owned string from &str, just return the last 2 segments
            let parent_str = parent.to_string_lossy();
            let name_str = name.to_string_lossy();
            // Find the position in the original string
            if let Some(pos) = path.rfind(&*parent_str) {
                return &path[pos..];
            }
            let _ = name_str; // suppress warning
        }
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_recall_block_empty() {
        assert_eq!(format_recall_block(&[]), "");
    }

    #[test]
    fn test_abbreviate_path() {
        let path = "/Users/vlad/stuff/docs/specification/sigil-editor/Application/Editor/language.md";
        let short = abbreviate_path(path);
        assert_eq!(short, "Application/Editor/language.md");
    }

    #[test]
    fn test_abbreviate_path_no_marker() {
        let path = "/tmp/test/language.md";
        let short = abbreviate_path(path);
        // Should return something reasonable
        assert!(short.contains("language.md"));
    }
}
