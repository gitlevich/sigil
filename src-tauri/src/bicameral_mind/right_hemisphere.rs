use crate::bicameral_mind::types::*;
use std::collections::{HashMap, HashSet};

/// Compare two ContrastSpace snapshots and produce a Disturbance.
/// This is the core of RightHemisphere's sensing: geometric change detection.
///
/// Operates purely on graph structure (edges + weights), not on text.
/// A rewording that preserves all @reference co-occurrences produces zero disturbance.
/// A small edit removing an @reference changes the graph and produces a signal.
pub fn detect_disturbance(old: &ContrastSpace, new: &ContrastSpace) -> Disturbance {
    let mut added_edges = Vec::new();
    let mut removed_edges = Vec::new();
    let mut weight_changes = Vec::new();

    // Index old edges by (a, b) pair for O(1) lookup
    let old_edge_map: HashMap<(&SigilId, &SigilId), &CoOccurrenceEdge> = old
        .edges
        .iter()
        .map(|e| {
            let key = if e.a < e.b {
                (&e.a, &e.b)
            } else {
                (&e.b, &e.a)
            };
            (key, e)
        })
        .collect();

    let new_edge_map: HashMap<(&SigilId, &SigilId), &CoOccurrenceEdge> = new
        .edges
        .iter()
        .map(|e| {
            let key = if e.a < e.b {
                (&e.a, &e.b)
            } else {
                (&e.b, &e.a)
            };
            (key, e)
        })
        .collect();

    // Find added and weight-changed edges
    for (key, new_edge) in &new_edge_map {
        match old_edge_map.get(key) {
            None => added_edges.push((*new_edge).clone()),
            Some(old_edge) => {
                if (new_edge.weight - old_edge.weight).abs() > f32::EPSILON {
                    weight_changes.push(WeightChange {
                        a: new_edge.a.clone(),
                        b: new_edge.b.clone(),
                        old_weight: old_edge.weight,
                        new_weight: new_edge.weight,
                    });
                }
            }
        }
    }

    // Find removed edges
    for (key, old_edge) in &old_edge_map {
        if !new_edge_map.contains_key(key) {
            removed_edges.push((*old_edge).clone());
        }
    }

    // Find new and lost sigils
    let old_sigils: HashSet<&SigilId> = old.spheres.keys().collect();
    let new_sigils_set: HashSet<&SigilId> = new.spheres.keys().collect();

    let new_sigils: Vec<SigilId> = new_sigils_set
        .difference(&old_sigils)
        .map(|id| (*id).clone())
        .collect();
    let lost_sigils: Vec<SigilId> = old_sigils
        .difference(&new_sigils_set)
        .map(|id| (*id).clone())
        .collect();

    Disturbance {
        added_edges,
        removed_edges,
        weight_changes,
        new_sigils,
        lost_sigils,
    }
}

/// Relevance filter: shapes with no affordances are background noise.
/// Returns true if the sigil is relevant (has affordances that could affect something).
///
/// This is the same filter used by both RightHemisphere (scope: live shapes)
/// and Subconscious (scope: Experience segments). Single-mechanism invariant.
pub fn is_relevant(sphere: &SigilSphere) -> bool {
    sphere.has_affordances()
}

/// Filter a disturbance to only include signals involving relevant sigils.
/// Removes edges and sigil events where neither endpoint has affordances.
pub fn filter_disturbance(
    disturbance: &Disturbance,
    space: &ContrastSpace,
) -> Disturbance {
    let is_relevant_id = |id: &SigilId| -> bool {
        space
            .spheres
            .get(id)
            .map_or(false, |s| is_relevant(s))
    };

    let is_relevant_edge = |e: &CoOccurrenceEdge| -> bool {
        is_relevant_id(&e.a) || is_relevant_id(&e.b)
    };

    Disturbance {
        added_edges: disturbance
            .added_edges
            .iter()
            .filter(|e| is_relevant_edge(e))
            .cloned()
            .collect(),
        removed_edges: disturbance
            .removed_edges
            .iter()
            .filter(|e| is_relevant_edge(e))
            .cloned()
            .collect(),
        weight_changes: disturbance
            .weight_changes
            .iter()
            .filter(|wc| is_relevant_id(&wc.a) || is_relevant_id(&wc.b))
            .cloned()
            .collect(),
        new_sigils: disturbance
            .new_sigils
            .iter()
            .filter(|id| is_relevant_id(id))
            .cloned()
            .collect(),
        lost_sigils: disturbance
            .lost_sigils
            .iter()
            .filter(|_id| {
                // For lost sigils, we can't check the new space — they're gone.
                // Always include: a lost sigil that had affordances is a significant event.
                true
            })
            .cloned()
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bicameral_mind::co_occurrence::add_file_to_space;
    use std::path::Path;

    fn make_sphere(name: &str, affordances: Vec<&str>, invariants: Vec<&str>) -> SigilSphere {
        SigilSphere {
            id: SigilId::new(name),
            affordances: affordances.into_iter().map(String::from).collect(),
            invariants: invariants.into_iter().map(String::from).collect(),
            content_volume: 100,
        }
    }

    #[test]
    fn test_rewording_no_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are related.");

        let mut new = ContrastSpace::new();
        add_file_to_space(
            &mut new,
            Path::new("a.md"),
            "@Alpha connects to @Beta in some way.",
        );

        let d = detect_disturbance(&old, &new);
        assert!(d.is_empty(), "rewording preserving refs should produce no disturbance");
    }

    #[test]
    fn test_removed_reference_produces_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are related.");

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@Alpha stands alone now.");

        let d = detect_disturbance(&old, &new);
        assert!(!d.is_empty());
        assert_eq!(d.removed_edges.len(), 1);
    }

    #[test]
    fn test_added_reference_produces_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha stands alone.");

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@Alpha and @Beta together now.");

        let d = detect_disturbance(&old, &new);
        assert!(!d.is_empty());
        assert_eq!(d.added_edges.len(), 1);
    }

    #[test]
    fn test_weight_change_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@A and @B.");

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@A and @B. Again @A with @B.");

        let d = detect_disturbance(&old, &new);
        assert_eq!(d.weight_changes.len(), 1);
        assert!((d.weight_changes[0].old_weight - 1.0).abs() < f32::EPSILON);
        assert!((d.weight_changes[0].new_weight - 2.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_structural_higher_amplitude_than_weight() {
        // Edge removal (structural) should have higher amplitude than weight change
        let structural = Disturbance {
            added_edges: Vec::new(),
            removed_edges: vec![CoOccurrenceEdge {
                a: SigilId::new("A"),
                b: SigilId::new("B"),
                weight: 1.0,
                sources: Vec::new(),
            }],
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        };

        let weight_only = Disturbance {
            added_edges: Vec::new(),
            removed_edges: Vec::new(),
            weight_changes: vec![WeightChange {
                a: SigilId::new("A"),
                b: SigilId::new("B"),
                old_weight: 1.0,
                new_weight: 2.0,
            }],
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        };

        assert!(
            structural.amplitude() > weight_only.amplitude(),
            "structural change should have higher amplitude than weight change"
        );
    }

    #[test]
    fn test_relevance_filter_no_affordances() {
        let mut space = ContrastSpace::new();
        space
            .spheres
            .insert(SigilId::new("A"), make_sphere("A", vec![], vec![]));
        space
            .spheres
            .insert(SigilId::new("B"), make_sphere("B", vec![], vec![]));

        let disturbance = Disturbance {
            added_edges: vec![CoOccurrenceEdge {
                a: SigilId::new("A"),
                b: SigilId::new("B"),
                weight: 1.0,
                sources: Vec::new(),
            }],
            removed_edges: Vec::new(),
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        };

        let filtered = filter_disturbance(&disturbance, &space);
        assert!(
            filtered.added_edges.is_empty(),
            "edges between sigils with no affordances should be filtered"
        );
    }

    #[test]
    fn test_relevance_filter_with_affordances() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("A"),
            make_sphere("A", vec!["do-something"], vec![]),
        );
        space
            .spheres
            .insert(SigilId::new("B"), make_sphere("B", vec![], vec![]));

        let disturbance = Disturbance {
            added_edges: vec![CoOccurrenceEdge {
                a: SigilId::new("A"),
                b: SigilId::new("B"),
                weight: 1.0,
                sources: Vec::new(),
            }],
            removed_edges: Vec::new(),
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        };

        let filtered = filter_disturbance(&disturbance, &space);
        assert_eq!(
            filtered.added_edges.len(),
            1,
            "edge with at least one affordance-bearing sigil should pass"
        );
    }

    #[test]
    fn test_formatting_no_disturbance() {
        // Whitespace/formatting changes that don't affect @references
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are close.");

        let mut new = ContrastSpace::new();
        add_file_to_space(
            &mut new,
            Path::new("a.md"),
            "  @Alpha   and   @Beta   are   close.  ",
        );

        let d = detect_disturbance(&old, &new);
        assert!(d.is_empty(), "formatting changes should not produce disturbance");
    }

    #[test]
    fn test_new_sigil_detected() {
        let old = ContrastSpace::new();
        let mut new = ContrastSpace::new();
        new.spheres.insert(
            SigilId::new("Fresh"),
            make_sphere("Fresh", vec!["exist"], vec![]),
        );

        let d = detect_disturbance(&old, &new);
        assert_eq!(d.new_sigils.len(), 1);
        assert_eq!(d.new_sigils[0].as_str(), "Fresh");
    }

    #[test]
    fn test_lost_sigil_detected() {
        let mut old = ContrastSpace::new();
        old.spheres.insert(
            SigilId::new("Gone"),
            make_sphere("Gone", vec!["was-here"], vec![]),
        );
        let new = ContrastSpace::new();

        let d = detect_disturbance(&old, &new);
        assert_eq!(d.lost_sigils.len(), 1);
        assert_eq!(d.lost_sigils[0].as_str(), "Gone");
    }
}
