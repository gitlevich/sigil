use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

/// Newtype for sigil names used as graph keys.
/// Prevents passing arbitrary strings where a sigil identity is expected.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
pub struct SigilId(String);

impl SigilId {
    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SigilId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A sigil as seen from outside — a sphere in ContrastSpace.
/// No coordinates: distance is computed from edge weights directly.
#[derive(Debug, Clone, Serialize)]
pub struct SigilSphere {
    pub id: SigilId,
    /// Names of affordances visible on the surface.
    pub affordances: Vec<String>,
    /// Names of invariants defining boundary rigidity.
    pub invariants: Vec<String>,
    /// Bytes of language content — proxy for sphere radius.
    pub content_volume: usize,
}

impl SigilSphere {
    pub fn has_affordances(&self) -> bool {
        !self.affordances.is_empty()
    }
}

/// Weighted edge: two sigils co-occurring in sentences.
/// Weight = number of distinct sentences containing both.
#[derive(Debug, Clone, Serialize)]
pub struct CoOccurrenceEdge {
    pub a: SigilId,
    pub b: SigilId,
    pub weight: f32,
    /// Source locations for lazy text retrieval (file, line number).
    pub sources: Vec<(PathBuf, usize)>,
}

/// The geometry. No coordinates — distances computed from edge weights.
/// Distance between two sigils = 1 / weight. No edge = infinite distance.
#[derive(Debug, Clone, Serialize)]
pub struct ContrastSpace {
    pub spheres: HashMap<SigilId, SigilSphere>,
    pub edges: Vec<CoOccurrenceEdge>,
    /// Per-file edge indices for incremental removal.
    /// When a file changes, remove its old edges, reparse, add new ones.
    #[serde(skip)]
    pub file_edges: HashMap<PathBuf, Vec<usize>>,
}

impl Default for ContrastSpace {
    fn default() -> Self {
        Self {
            spheres: HashMap::new(),
            edges: Vec::new(),
            file_edges: HashMap::new(),
        }
    }
}

impl ContrastSpace {
    pub fn new() -> Self {
        Self {
            spheres: HashMap::new(),
            edges: Vec::new(),
            file_edges: HashMap::new(),
        }
    }

    /// Distance between two sigils. Returns None if no edge exists (infinite distance).
    pub fn distance(&self, a: &SigilId, b: &SigilId) -> Option<f32> {
        self.edges
            .iter()
            .find(|e| (&e.a == a && &e.b == b) || (&e.a == b && &e.b == a))
            .map(|e| 1.0 / e.weight)
    }

}

/// What changed between two ContrastSpace snapshots.
#[derive(Debug, Clone, Serialize)]
pub struct Disturbance {
    /// Edges that were added (new co-occurrences).
    pub added_edges: Vec<CoOccurrenceEdge>,
    /// Edges that were removed (lost co-occurrences).
    pub removed_edges: Vec<CoOccurrenceEdge>,
    /// Edges whose weight changed.
    pub weight_changes: Vec<WeightChange>,
    /// Sigils that appeared for the first time.
    pub new_sigils: Vec<SigilId>,
    /// Sigils that disappeared entirely.
    pub lost_sigils: Vec<SigilId>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeightChange {
    pub a: SigilId,
    pub b: SigilId,
    pub old_weight: f32,
    pub new_weight: f32,
}

impl Disturbance {
    pub fn is_empty(&self) -> bool {
        self.added_edges.is_empty()
            && self.removed_edges.is_empty()
            && self.weight_changes.is_empty()
            && self.new_sigils.is_empty()
            && self.lost_sigils.is_empty()
    }

    /// Amplitude: total geometric change. Structural changes (added/removed edges)
    /// weigh more than weight changes, per conceptual-salience invariant.
    pub fn amplitude(&self) -> f32 {
        let structural = (self.added_edges.len() + self.removed_edges.len()) as f32 * 2.0;
        let weight_delta: f32 = self
            .weight_changes
            .iter()
            .map(|wc| (wc.new_weight - wc.old_weight).abs())
            .sum();
        let identity = (self.new_sigils.len() + self.lost_sigils.len()) as f32 * 3.0;
        structural + weight_delta + identity
    }
}

/// Error type for the bicameral_mind module.
#[derive(Debug)]
pub enum BicameralError {
    Parse(String),
    Io(std::io::Error),
}

impl fmt::Display for BicameralError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse(msg) => write!(f, "parse error: {msg}"),
            Self::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for BicameralError {}

impl From<std::io::Error> for BicameralError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
