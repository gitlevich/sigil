use crate::bicameral_mind::types::*;
use regex::Regex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Extract @references from a single sentence.
/// Returns the unique sigil names referenced (without the @ prefix).
fn extract_refs(sentence: &str) -> Vec<String> {
    let re = Regex::new(r"@(\w+)").unwrap();
    let mut refs: Vec<String> = re
        .captures_iter(sentence)
        .map(|c| c[1].to_string())
        .collect();
    refs.sort();
    refs.dedup();
    refs
}

/// Split markdown text into sentences.
/// Splits on period, exclamation, question mark, or newline followed by whitespace.
/// Strips markdown headers (lines starting with #).
fn split_sentences(text: &str) -> Vec<(String, usize)> {
    let mut sentences = Vec::new();
    for (line_idx, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        // Skip empty lines and pure header lines (but include header content)
        if trimmed.is_empty() {
            continue;
        }
        // Strip leading # markers from headers
        let content = if trimmed.starts_with('#') {
            trimmed.trim_start_matches('#').trim()
        } else {
            trimmed
        };
        if content.is_empty() {
            continue;
        }
        // Split on sentence boundaries within the line
        let parts: Vec<&str> = content
            .split_inclusive(|c: char| c == '.' || c == '!' || c == '?')
            .collect();
        for part in parts {
            let s = part.trim();
            if !s.is_empty() {
                sentences.push((s.to_string(), line_idx + 1));
            }
        }
    }
    sentences
}

/// Parse a single markdown file and extract co-occurrence edges.
/// Returns pairs of (SigilId, SigilId, line_number) for every pair of
/// @references co-occurring in the same sentence.
pub fn extract_co_occurrences(
    content: &str,
    _file_path: &Path,
) -> Vec<(SigilId, SigilId, usize)> {
    let mut result = Vec::new();
    for (sentence, line_num) in split_sentences(content) {
        let refs = extract_refs(&sentence);
        // Generate all unique pairs — order normalized (a < b)
        for i in 0..refs.len() {
            for j in (i + 1)..refs.len() {
                let a = SigilId::new(&refs[i]);
                let b = SigilId::new(&refs[j]);
                if a < b {
                    result.push((a, b, line_num));
                } else {
                    result.push((b, a, line_num));
                }
            }
        }
    }
    result
}

/// Scan a directory tree for .md files (excluding hidden dirs, .sigil/, chats/).
/// Returns (file_path, file_content) pairs.
pub fn scan_spec_files(root: &Path) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip hidden directories, .sigil metadata, and chat logs.
            // But never filter the root itself (depth 0).
            if e.file_type().is_dir() && e.depth() > 0 {
                return !name.starts_with('.') && name != "chats" && name != "node_modules";
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
            if let Ok(content) = std::fs::read_to_string(path) {
                files.push((path.to_path_buf(), content));
            }
        }
    }
    files
}

/// Build a ContrastSpace from a directory of spec files.
/// This is the full rebuild — called at app startup.
pub fn build_contrast_space(root: &Path) -> Result<ContrastSpace, BicameralError> {
    let files = scan_spec_files(root);
    let mut space = ContrastSpace::new();

    for (path, content) in &files {
        add_file_to_space(&mut space, path, content);
    }

    // Build sphere inventory from the sigil directory structure
    populate_spheres_from_tree(root, &mut space);

    Ok(space)
}

/// Add a single file's co-occurrences to the ContrastSpace.
/// Tracks which edge indices belong to this file for incremental removal.
pub fn add_file_to_space(space: &mut ContrastSpace, path: &Path, content: &str) {
    let co_occurrences = extract_co_occurrences(content, path);

    let mut file_edge_indices = Vec::new();

    for (a, b, line_num) in co_occurrences {
        // Check if edge already exists
        if let Some(idx) = space
            .edges
            .iter()
            .position(|e| (&e.a == &a && &e.b == &b) || (&e.a == &b && &e.b == &a))
        {
            space.edges[idx].weight += 1.0;
            space.edges[idx].sources.push((path.to_path_buf(), line_num));
            file_edge_indices.push(idx);
        } else {
            let idx = space.edges.len();
            space.edges.push(CoOccurrenceEdge {
                a,
                b,
                weight: 1.0,
                sources: vec![(path.to_path_buf(), line_num)],
            });
            file_edge_indices.push(idx);
        }
    }

    space
        .file_edges
        .insert(path.to_path_buf(), file_edge_indices);
}

/// Remove a file's contribution to the ContrastSpace.
/// Decrements edge weights and removes edges that drop to zero.
pub fn remove_file_from_space(space: &mut ContrastSpace, path: &Path) {
    if let Some(indices) = space.file_edges.remove(path) {
        // Count how many times each edge index appears (one file can contribute multiple
        // co-occurrences to the same edge)
        let mut decrements: HashMap<usize, f32> = HashMap::new();
        for idx in &indices {
            *decrements.entry(*idx).or_default() += 1.0;
        }

        // Decrement weights
        for (&idx, &dec) in &decrements {
            if idx < space.edges.len() {
                space.edges[idx].weight -= dec;
                // Remove sources from this file
                space.edges[idx]
                    .sources
                    .retain(|(p, _)| p != path);
            }
        }

        // Remove edges with zero or negative weight (iterate in reverse to preserve indices)
        let mut to_remove: Vec<usize> = space
            .edges
            .iter()
            .enumerate()
            .filter(|(_, e)| e.weight <= 0.0)
            .map(|(i, _)| i)
            .collect();
        to_remove.sort_unstable();
        to_remove.reverse();

        for idx in &to_remove {
            space.edges.swap_remove(*idx);
        }

        // Rebuild file_edges indices after swap_remove (indices shifted)
        // This is O(files * edges_per_file) but files are small
        if !to_remove.is_empty() {
            rebuild_file_edge_indices(space);
        }
    }
}

/// Update a single file: remove old contribution, add new.
pub fn update_file_in_space(space: &mut ContrastSpace, path: &Path, new_content: &str) {
    remove_file_from_space(space, path);
    add_file_to_space(space, path, new_content);
}

/// Rebuild file_edges index after structural changes (swap_remove).
fn rebuild_file_edge_indices(space: &mut ContrastSpace) {
    space.file_edges.clear();
    for (idx, edge) in space.edges.iter().enumerate() {
        for (path, _) in &edge.sources {
            space
                .file_edges
                .entry(path.clone())
                .or_default()
                .push(idx);
        }
    }
}

/// Populate sphere inventory from the sigil directory tree.
/// Each directory with a language.md is a sigil. Affordances = affordance-*.md files.
/// Invariants = invariant-*.md files. Content volume = bytes of language.md.
fn populate_spheres_from_tree(root: &Path, space: &mut ContrastSpace) {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() && e.depth() > 0 {
                return !name.starts_with('.') && name != "chats" && name != "node_modules";
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let dir = entry.path();
        let language_file = dir.join("language.md");
        if !language_file.exists() {
            continue;
        }
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }

        let content_volume = std::fs::read_to_string(&language_file)
            .map(|c| c.len())
            .unwrap_or(0);

        let affordances: Vec<String> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with("affordance-") && n.ends_with(".md")
            })
            .map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.strip_prefix("affordance-")
                    .and_then(|s| s.strip_suffix(".md"))
                    .unwrap_or(&n)
                    .to_string()
            })
            .collect();

        let invariants: Vec<String> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with("invariant-") && n.ends_with(".md")
            })
            .map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.strip_prefix("invariant-")
                    .and_then(|s| s.strip_suffix(".md"))
                    .unwrap_or(&n)
                    .to_string()
            })
            .collect();

        let id = SigilId::new(&name);
        space.spheres.insert(
            id.clone(),
            SigilSphere {
                id,
                affordances,
                invariants,
                content_volume,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    #[test]
    fn test_extract_refs_basic() {
        let refs = extract_refs("@Alpha and @Beta are related.");
        assert_eq!(refs, vec!["Alpha", "Beta"]);
    }

    #[test]
    fn test_extract_refs_dedup() {
        let refs = extract_refs("@Alpha references @Alpha again.");
        assert_eq!(refs, vec!["Alpha"]);
    }

    #[test]
    fn test_extract_refs_none() {
        let refs = extract_refs("No references here.");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_split_sentences_basic() {
        let sentences = split_sentences("First sentence. Second sentence.");
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0].0, "First sentence.");
        assert_eq!(sentences[1].0, "Second sentence.");
    }

    #[test]
    fn test_split_sentences_strips_headers() {
        let sentences = split_sentences("## My Header\nContent here.");
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0].0, "My Header");
        assert_eq!(sentences[1].0, "Content here.");
    }

    #[test]
    fn test_sentence_co_occurrence() {
        let pairs = extract_co_occurrences(
            "@Alpha and @Beta in same sentence. @Gamma alone here.",
            Path::new("test.md"),
        );
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, SigilId::new("Alpha"));
        assert_eq!(pairs[0].1, SigilId::new("Beta"));
    }

    #[test]
    fn test_paragraph_no_co_occurrence() {
        let pairs = extract_co_occurrences(
            "@Alpha in first sentence. @Beta in second sentence.",
            Path::new("test.md"),
        );
        // Alpha and Beta are in different sentences — no co-occurrence
        assert!(pairs.is_empty());
    }

    #[test]
    fn test_transitive_irrelevance() {
        let pairs = extract_co_occurrences(
            "@Alpha and @Beta together. @Beta and @Gamma together. @Alpha alone.",
            Path::new("test.md"),
        );
        let has_alpha_beta = pairs.iter().any(|(a, b, _)| {
            (a.as_str() == "Alpha" && b.as_str() == "Beta")
                || (a.as_str() == "Beta" && b.as_str() == "Alpha")
        });
        let has_beta_gamma = pairs.iter().any(|(a, b, _)| {
            (a.as_str() == "Beta" && b.as_str() == "Gamma")
                || (a.as_str() == "Gamma" && b.as_str() == "Beta")
        });
        let has_alpha_gamma = pairs.iter().any(|(a, b, _)| {
            (a.as_str() == "Alpha" && b.as_str() == "Gamma")
                || (a.as_str() == "Gamma" && b.as_str() == "Alpha")
        });
        assert!(has_alpha_beta);
        assert!(has_beta_gamma);
        assert!(!has_alpha_gamma, "transitive path should not create edge");
    }

    #[test]
    fn test_repetition_strengthens() {
        let mut space = ContrastSpace::new();
        let content = "@Alpha and @Beta here. Another sentence. @Alpha with @Beta again. And @Alpha plus @Beta once more.";
        add_file_to_space(&mut space, Path::new("test.md"), content);
        let edge = space.edges.iter().find(|e| {
            (e.a.as_str() == "Alpha" && e.b.as_str() == "Beta")
                || (e.a.as_str() == "Beta" && e.b.as_str() == "Alpha")
        });
        assert!(edge.is_some());
        assert_eq!(edge.unwrap().weight, 3.0);
    }

    #[test]
    fn test_distance_inverse_weight() {
        let mut space = ContrastSpace::new();
        let content = "@A and @B. @A and @B. @A and @B."; // weight 3
        add_file_to_space(&mut space, Path::new("test.md"), content);
        let dist = space.distance(&SigilId::new("A"), &SigilId::new("B"));
        assert!(dist.is_some());
        let d = dist.unwrap();
        assert!((d - 1.0 / 3.0).abs() < 0.001);
    }

    #[test]
    fn test_no_distance_no_edge() {
        let space = ContrastSpace::new();
        assert!(space.distance(&SigilId::new("A"), &SigilId::new("B")).is_none());
    }

    #[test]
    fn test_incremental_add_file() {
        let mut space = ContrastSpace::new();
        add_file_to_space(&mut space, Path::new("a.md"), "@X and @Y together.");
        assert_eq!(space.edges.len(), 1);
        add_file_to_space(&mut space, Path::new("b.md"), "@Y and @Z together.");
        assert_eq!(space.edges.len(), 2);
    }

    #[test]
    fn test_incremental_remove_file() {
        let mut space = ContrastSpace::new();
        add_file_to_space(&mut space, Path::new("a.md"), "@X and @Y together.");
        add_file_to_space(&mut space, Path::new("b.md"), "@Y and @Z together.");
        assert_eq!(space.edges.len(), 2);
        remove_file_from_space(&mut space, Path::new("a.md"));
        assert_eq!(space.edges.len(), 1);
        // Only Y-Z edge remains
        assert!(space.distance(&SigilId::new("X"), &SigilId::new("Y")).is_none());
        assert!(space.distance(&SigilId::new("Y"), &SigilId::new("Z")).is_some());
    }

    #[test]
    fn test_update_file() {
        let mut space = ContrastSpace::new();
        add_file_to_space(&mut space, Path::new("a.md"), "@X and @Y together.");
        assert!(space.distance(&SigilId::new("X"), &SigilId::new("Y")).is_some());

        update_file_in_space(&mut space, Path::new("a.md"), "@X and @Z together.");
        assert!(space.distance(&SigilId::new("X"), &SigilId::new("Y")).is_none());
        assert!(space.distance(&SigilId::new("X"), &SigilId::new("Z")).is_some());
    }

    #[test]
    fn test_empty_project() {
        let tmp = TempDir::new().unwrap();
        let space = build_contrast_space(tmp.path()).unwrap();
        assert!(space.spheres.is_empty());
        assert!(space.edges.is_empty());
    }

    #[test]
    fn test_build_from_directory() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Create a minimal sigil structure
        let sigil_a = root.join("Alpha");
        fs::create_dir_all(&sigil_a).unwrap();
        fs::write(
            sigil_a.join("language.md"),
            "@Beta is referenced here. @Gamma also appears with @Beta.",
        )
        .unwrap();
        fs::write(sigil_a.join("affordance-do-something.md"), "content").unwrap();

        let sigil_b = root.join("Beta");
        fs::create_dir_all(&sigil_b).unwrap();
        fs::write(sigil_b.join("language.md"), "Beta stands alone.").unwrap();

        let sigil_g = root.join("Gamma");
        fs::create_dir_all(&sigil_g).unwrap();
        fs::write(sigil_g.join("language.md"), "Gamma content.").unwrap();
        fs::write(sigil_g.join("invariant-some-rule.md"), "rule content").unwrap();

        let space = build_contrast_space(root).unwrap();

        // Spheres
        assert!(space.spheres.contains_key(&SigilId::new("Alpha")));
        assert!(space.spheres.contains_key(&SigilId::new("Beta")));
        assert!(space.spheres.contains_key(&SigilId::new("Gamma")));

        // Alpha has affordance
        assert!(space.spheres[&SigilId::new("Alpha")].has_affordances());
        // Gamma has invariant
        assert!(!space.spheres[&SigilId::new("Gamma")].invariants.is_empty());

        // Edges from Alpha's language.md
        // "Beta is referenced here" — only @Beta, no pair
        // "@Gamma also appears with @Beta" — @Gamma + @Beta = edge
        assert!(space
            .distance(&SigilId::new("Beta"), &SigilId::new("Gamma"))
            .is_some());
    }

    #[test]
    fn test_file_deleted_gracefully() {
        let mut space = ContrastSpace::new();
        add_file_to_space(&mut space, Path::new("a.md"), "@X and @Y.");
        // Remove a file that doesn't exist in tracking — no panic
        remove_file_from_space(&mut space, Path::new("nonexistent.md"));
        assert_eq!(space.edges.len(), 1);
    }
}
