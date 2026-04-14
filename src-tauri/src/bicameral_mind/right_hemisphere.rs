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

/// Scope for the RelevanceFilter. RightHemisphere filters live disturbances.
/// Subconscious filters Experience segments. Same mechanism, different scope.
/// Invariant: single-mechanism.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RelevanceScope {
    /// Live disturbance from RightHemisphere sensing.
    Live,
    /// Historical Experience segment from Subconscious filtering.
    Subconscious,
}

/// Relationship between a sigil and the currently active sigil.
#[derive(Debug, Clone, PartialEq)]
pub enum SigilRelation {
    /// The sigil is a child of the active sigil. Always relevant.
    Child,
    /// The sigil is the parent of the active sigil. High relevance (laws of nature).
    Parent,
    /// The sigil is a direct neighbor (co-occurring) in ContrastSpace. Dependency risk.
    Neighbor,
    /// No direct relationship.
    Distant,
}

/// Result of relevance filtering.
#[derive(Debug, Clone)]
pub struct RelevanceResult {
    pub sigil: SigilId,
    pub relation: SigilRelation,
    pub relevant: bool,
    /// Whether this should escalate (Subconscious scope never escalates).
    pub escalate: bool,
}

/// Single parameterized relevance filter.
/// Invariants: affordance-relevance, relevance-gating, single-mechanism, no-escalation.
///
/// Relevant = sigil has affordances AND is related to the active sigil's invariants.
/// Children: always relevant.
/// Parent: always relevant (laws of nature).
/// Neighbors: relevant if their affordances match active sigil's invariants.
/// Distant: not relevant.
///
/// Subconscious scope: never produces escalation signal.
pub fn filter_relevance(
    sigil: &SigilId,
    space: &ContrastSpace,
    relation: SigilRelation,
    scope: RelevanceScope,
) -> RelevanceResult {
    let sphere = space.spheres.get(sigil);

    // No affordances = noise (affordance-relevance invariant)
    let has_affordances = sphere.map_or(false, |s| s.has_affordances());

    let relevant = match &relation {
        SigilRelation::Child => true,       // always relevant
        SigilRelation::Parent => true,      // laws of nature
        SigilRelation::Neighbor => has_affordances,
        SigilRelation::Distant => false,
    };

    // Subconscious never escalates (no-escalation invariant)
    let escalate = relevant && scope == RelevanceScope::Live;

    RelevanceResult {
        sigil: sigil.clone(),
        relation,
        relevant,
        escalate,
    }
}

/// Determine the relationship of a sigil to the active sigil based on path structure.
/// In a sigil tree, parent/child is determined by directory containment.
/// Neighbors are determined by co-occurrence edges in ContrastSpace.
pub fn classify_relation(
    sigil: &SigilId,
    active_sigil: &SigilId,
    space: &ContrastSpace,
    children: &[SigilId],
    parent: Option<&SigilId>,
) -> SigilRelation {
    if children.contains(sigil) {
        return SigilRelation::Child;
    }
    if parent == Some(sigil) {
        return SigilRelation::Parent;
    }
    // Check if sigil is a direct neighbor via co-occurrence
    let has_edge = space.edges.iter().any(|e| {
        (&e.a == sigil && &e.b == active_sigil) || (&e.a == active_sigil && &e.b == sigil)
    });
    if has_edge {
        return SigilRelation::Neighbor;
    }
    SigilRelation::Distant
}

/// Filter a disturbance through relevance for a given scope.
/// Returns only the sigils that pass the filter.
pub fn filter_disturbance(
    disturbance: &Disturbance,
    active_sigil: &SigilId,
    space: &ContrastSpace,
    children: &[SigilId],
    parent: Option<&SigilId>,
    scope: RelevanceScope,
) -> Vec<RelevanceResult> {
    disturbance
        .involved_sigils()
        .into_iter()
        .map(|s| {
            let relation = classify_relation(&s, active_sigil, space, children, parent);
            filter_relevance(&s, space, relation, scope)
        })
        .filter(|r| r.relevant)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bicameral_mind::co_occurrence::add_file_to_space;
    use std::collections::HashMap;
    use std::path::Path;

    fn make_sphere(name: &str, affordances: Vec<&str>, invariants: Vec<&str>) -> SigilSphere {
        SigilSphere {
            id: SigilId::new(name),
            affordances: affordances.into_iter().map(String::from).collect(),
            invariants: invariants.into_iter().map(String::from).collect(),
            content_volume: 100,
            language_content: None,
        }
    }

    #[test]
    fn test_rewording_no_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are related.", &HashMap::new());

        let mut new = ContrastSpace::new();
        add_file_to_space(
            &mut new,
            Path::new("a.md"),
            "@Alpha connects to @Beta in some way.",
            &HashMap::new(),
        );

        let d = detect_disturbance(&old, &new);
        assert!(d.is_empty(), "rewording preserving refs should produce no disturbance");
    }

    #[test]
    fn test_removed_reference_produces_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are related.", &HashMap::new());

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@Alpha stands alone now.", &HashMap::new());

        let d = detect_disturbance(&old, &new);
        assert!(!d.is_empty());
        assert_eq!(d.removed_edges.len(), 1);
    }

    #[test]
    fn test_added_reference_produces_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha stands alone.", &HashMap::new());

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@Alpha and @Beta together now.", &HashMap::new());

        let d = detect_disturbance(&old, &new);
        assert!(!d.is_empty());
        assert_eq!(d.added_edges.len(), 1);
    }

    #[test]
    fn test_weight_change_disturbance() {
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@A and @B.", &HashMap::new());

        let mut new = ContrastSpace::new();
        add_file_to_space(&mut new, Path::new("a.md"), "@A and @B. Again @A with @B.", &HashMap::new());

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
    fn test_formatting_no_disturbance() {
        // Whitespace/formatting changes that don't affect @references
        let mut old = ContrastSpace::new();
        add_file_to_space(&mut old, Path::new("a.md"), "@Alpha and @Beta are close.", &HashMap::new());

        let mut new = ContrastSpace::new();
        add_file_to_space(
            &mut new,
            Path::new("a.md"),
            "  @Alpha   and   @Beta   are   close.  ",
            &HashMap::new(),
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

    // --- Relevance filter tests ---

    #[test]
    fn test_children_always_relevant() {
        let space = ContrastSpace::new();
        let child = SigilId::new("Child");
        let active = SigilId::new("Parent");
        let result = filter_relevance(
            &child, &space,
            SigilRelation::Child, RelevanceScope::Live,
        );
        assert!(result.relevant, "children should always be relevant");
    }

    #[test]
    fn test_parent_always_relevant() {
        let space = ContrastSpace::new();
        let parent = SigilId::new("GrandParent");
        let active = SigilId::new("Child");
        let result = filter_relevance(
            &parent, &space,
            SigilRelation::Parent, RelevanceScope::Live,
        );
        assert!(result.relevant, "parent should always be relevant");
    }

    #[test]
    fn test_neighbor_without_affordances_filtered() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("Neighbor"),
            make_sphere("Neighbor", vec![], vec!["some-rule"]),
        );
        let result = filter_relevance(
            &SigilId::new("Neighbor"), &space,
            SigilRelation::Neighbor, RelevanceScope::Live,
        );
        assert!(!result.relevant, "neighbor without affordances is noise");
    }

    #[test]
    fn test_neighbor_with_affordances_relevant() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("Neighbor"),
            make_sphere("Neighbor", vec!["do-something"], vec![]),
        );
        let result = filter_relevance(
            &SigilId::new("Neighbor"), &space,
            SigilRelation::Neighbor, RelevanceScope::Live,
        );
        assert!(result.relevant, "neighbor with affordances should be relevant");
    }

    #[test]
    fn test_subconscious_never_escalates() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("Child"),
            make_sphere("Child", vec!["act"], vec![]),
        );
        let result = filter_relevance(
            &SigilId::new("Child"), &space,
            SigilRelation::Child, RelevanceScope::Subconscious,
        );
        assert!(result.relevant);
        assert!(!result.escalate, "subconscious must never escalate");
    }

    #[test]
    fn test_live_scope_can_escalate() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("Nb"),
            make_sphere("Nb", vec!["act"], vec![]),
        );
        let result = filter_relevance(
            &SigilId::new("Nb"), &space,
            SigilRelation::Neighbor, RelevanceScope::Live,
        );
        assert!(result.relevant);
        assert!(result.escalate, "live scope should allow escalation");
    }

    #[test]
    fn test_distant_never_relevant() {
        let mut space = ContrastSpace::new();
        space.spheres.insert(
            SigilId::new("Far"),
            make_sphere("Far", vec!["act"], vec![]),
        );
        let result = filter_relevance(
            &SigilId::new("Far"), &space,
            SigilRelation::Distant, RelevanceScope::Live,
        );
        assert!(!result.relevant, "distant sigils should not be relevant");
    }

    #[test]
    fn test_classify_child() {
        let space = ContrastSpace::new();
        let children = vec![SigilId::new("Kid")];
        let r = classify_relation(
            &SigilId::new("Kid"), &SigilId::new("Dad"), &space,
            &children, None,
        );
        assert_eq!(r, SigilRelation::Child);
    }

    #[test]
    fn test_classify_parent() {
        let space = ContrastSpace::new();
        let parent = SigilId::new("Dad");
        let r = classify_relation(
            &SigilId::new("Dad"), &SigilId::new("Kid"), &space,
            &[], Some(&parent),
        );
        assert_eq!(r, SigilRelation::Parent);
    }

    #[test]
    fn test_classify_neighbor_via_edge() {
        let mut space = ContrastSpace::new();
        add_file_to_space(&mut space, Path::new("x.md"), "@Active and @Nb together.", &HashMap::new());
        let r = classify_relation(
            &SigilId::new("Nb"), &SigilId::new("Active"), &space,
            &[], None,
        );
        assert_eq!(r, SigilRelation::Neighbor);
    }

    #[test]
    fn test_filter_disturbance_single_mechanism() {
        // Same filter logic for both Live and Subconscious scope — just different escalation
        let mut space = ContrastSpace::new();
        space.spheres.insert(SigilId::new("Kid"), make_sphere("Kid", vec!["play"], vec![]));
        let children = vec![SigilId::new("Kid")];

        let d = Disturbance {
            added_edges: Vec::new(),
            removed_edges: Vec::new(),
            weight_changes: Vec::new(),
            new_sigils: vec![SigilId::new("Kid")],
            lost_sigils: Vec::new(),
        };

        let live = filter_disturbance(&d, &SigilId::new("Dad"), &space, &children, None, RelevanceScope::Live);
        let sub = filter_disturbance(&d, &SigilId::new("Dad"), &space, &children, None, RelevanceScope::Subconscious);

        assert_eq!(live.len(), sub.len(), "same filter, same results");
        assert!(live[0].escalate, "live can escalate");
        assert!(!sub[0].escalate, "subconscious cannot escalate");
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
