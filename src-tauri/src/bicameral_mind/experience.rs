use crate::bicameral_mind::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

/// A single entry in the Experience journal.
/// Records what changed in the geometry during an edit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperienceEntry {
    pub timestamp: DateTime<Utc>,
    pub session_id: u64,
    /// Sigils involved in the geometry change.
    pub sigils_involved: Vec<SigilId>,
    /// The sigil currently open in the editor.
    pub active_sigil: SigilId,
    /// Edge deltas from the disturbance.
    pub edge_deltas: Vec<EdgeDelta>,
    /// Which file triggered this entry.
    pub source_file: PathBuf,
}

/// A single edge change recorded in Experience.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeDelta {
    Added { a: SigilId, b: SigilId, weight: f32 },
    Removed { a: SigilId, b: SigilId, weight: f32 },
    WeightChanged { a: SigilId, b: SigilId, old: f32, new: f32 },
}

/// Append-only JSONL journal. One file per session.
/// Invariants: append-only, causal-ordering, session-bounded, complete.
pub struct Experience {
    /// Directory where session files live.
    journal_dir: PathBuf,
    /// Current session id.
    session_id: u64,
    /// In-memory buffer of recent entries (bounded window).
    buffer: Vec<ExperienceEntry>,
    /// Max entries to keep in memory. Older entries remain on disk.
    buffer_limit: usize,
    /// Timestamp of last recorded entry (for idle detection).
    last_entry_at: Option<DateTime<Utc>>,
    /// Idle threshold for session boundary (30 minutes).
    idle_threshold_secs: i64,
}

impl Experience {
    /// Create a new Experience journal rooted at `journal_dir`.
    /// Scans existing session files to determine the next session id.
    pub fn new(journal_dir: PathBuf) -> Self {
        let session_id = Self::next_session_id(&journal_dir);
        Self {
            journal_dir,
            session_id,
            buffer: Vec::new(),
            buffer_limit: 1000,
            last_entry_at: None,
            idle_threshold_secs: 30 * 60,
        }
    }

    /// Append an entry. Checks for session boundary first.
    /// Returns the session_id used (may have incremented).
    pub fn record(
        &mut self,
        active_sigil: SigilId,
        disturbance: &Disturbance,
        source_file: PathBuf,
    ) -> Result<u64, BicameralError> {
        let now = Utc::now();

        // Check idle-based session boundary
        if let Some(last) = self.last_entry_at {
            let elapsed = (now - last).num_seconds();
            if elapsed >= self.idle_threshold_secs {
                self.end_session();
            }
        }

        self.last_entry_at = Some(now);

        // Collect sigils involved
        let mut sigils: Vec<SigilId> = Vec::new();
        for edge in &disturbance.added_edges {
            if !sigils.contains(&edge.a) { sigils.push(edge.a.clone()); }
            if !sigils.contains(&edge.b) { sigils.push(edge.b.clone()); }
        }
        for edge in &disturbance.removed_edges {
            if !sigils.contains(&edge.a) { sigils.push(edge.a.clone()); }
            if !sigils.contains(&edge.b) { sigils.push(edge.b.clone()); }
        }
        for wc in &disturbance.weight_changes {
            if !sigils.contains(&wc.a) { sigils.push(wc.a.clone()); }
            if !sigils.contains(&wc.b) { sigils.push(wc.b.clone()); }
        }
        for s in &disturbance.new_sigils {
            if !sigils.contains(s) { sigils.push(s.clone()); }
        }
        for s in &disturbance.lost_sigils {
            if !sigils.contains(s) { sigils.push(s.clone()); }
        }

        // Build edge deltas
        let mut edge_deltas = Vec::new();
        for e in &disturbance.added_edges {
            edge_deltas.push(EdgeDelta::Added {
                a: e.a.clone(),
                b: e.b.clone(),
                weight: e.weight,
            });
        }
        for e in &disturbance.removed_edges {
            edge_deltas.push(EdgeDelta::Removed {
                a: e.a.clone(),
                b: e.b.clone(),
                weight: e.weight,
            });
        }
        for wc in &disturbance.weight_changes {
            edge_deltas.push(EdgeDelta::WeightChanged {
                a: wc.a.clone(),
                b: wc.b.clone(),
                old: wc.old_weight,
                new: wc.new_weight,
            });
        }

        let entry = ExperienceEntry {
            timestamp: now,
            session_id: self.session_id,
            sigils_involved: sigils,
            active_sigil,
            edge_deltas,
            source_file,
        };

        // Append to disk
        self.append_to_disk(&entry)?;

        // Append to buffer, evict oldest if over limit
        self.buffer.push(entry);
        if self.buffer.len() > self.buffer_limit {
            self.buffer.remove(0);
        }

        Ok(self.session_id)
    }

    /// End the current session and start a new one.
    pub fn end_session(&mut self) {
        self.session_id += 1;
        self.last_entry_at = None;
        // Keep buffer across sessions — it's a sliding window, not session-scoped.
    }

    /// Current session id.
    pub fn session_id(&self) -> u64 {
        self.session_id
    }

    /// Number of entries in the in-memory buffer.
    pub fn buffer_len(&self) -> usize {
        self.buffer.len()
    }

    /// Get the in-memory buffer (most recent entries).
    pub fn recent_entries(&self) -> &[ExperienceEntry] {
        &self.buffer
    }

    /// Read all entries for a specific session from disk.
    pub fn read_session(&self, session_id: u64) -> Result<Vec<ExperienceEntry>, BicameralError> {
        let path = self.session_file(session_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let file = fs::File::open(&path)?;
        let reader = BufReader::new(file);
        let mut entries = Vec::new();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let entry: ExperienceEntry = serde_json::from_str(&line)
                .map_err(|e| BicameralError::Parse(format!("JSONL parse error: {e}")))?;
            entries.push(entry);
        }
        Ok(entries)
    }

    fn session_file(&self, session_id: u64) -> PathBuf {
        self.journal_dir.join(format!("session-{session_id}.jsonl"))
    }

    fn append_to_disk(&self, entry: &ExperienceEntry) -> Result<(), BicameralError> {
        fs::create_dir_all(&self.journal_dir)?;
        let path = self.session_file(entry.session_id);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let json = serde_json::to_string(entry)
            .map_err(|e| BicameralError::Parse(format!("serialize error: {e}")))?;
        writeln!(file, "{json}")?;
        Ok(())
    }

    fn next_session_id(dir: &Path) -> u64 {
        if !dir.exists() {
            return 1;
        }
        let mut max_id = 0u64;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(rest) = name.strip_prefix("session-") {
                    if let Some(num_str) = rest.strip_suffix(".jsonl") {
                        if let Ok(n) = num_str.parse::<u64>() {
                            max_id = max_id.max(n);
                        }
                    }
                }
            }
        }
        max_id + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_disturbance_with_added(a: &str, b: &str) -> Disturbance {
        Disturbance {
            added_edges: vec![CoOccurrenceEdge {
                a: SigilId::new(a),
                b: SigilId::new(b),
                weight: 1.0,
                sources: Vec::new(),
            }],
            removed_edges: Vec::new(),
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        }
    }

    fn make_disturbance_with_removed(a: &str, b: &str) -> Disturbance {
        Disturbance {
            added_edges: Vec::new(),
            removed_edges: vec![CoOccurrenceEdge {
                a: SigilId::new(a),
                b: SigilId::new(b),
                weight: 1.0,
                sources: Vec::new(),
            }],
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        }
    }

    #[test]
    fn test_experience_append_only() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));

        let d = make_disturbance_with_added("A", "B");
        exp.record(SigilId::new("Root"), &d, PathBuf::from("a.md")).unwrap();
        exp.record(SigilId::new("Root"), &d, PathBuf::from("b.md")).unwrap();

        // Read back from disk — both entries present
        let entries = exp.read_session(exp.session_id()).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_experience_causal_order() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));

        let d1 = make_disturbance_with_added("A", "B");
        let d2 = make_disturbance_with_removed("A", "B");
        exp.record(SigilId::new("Root"), &d1, PathBuf::from("a.md")).unwrap();
        exp.record(SigilId::new("Root"), &d2, PathBuf::from("a.md")).unwrap();

        let entries = exp.read_session(exp.session_id()).unwrap();
        assert!(entries[0].timestamp <= entries[1].timestamp);
    }

    #[test]
    fn test_experience_session_boundary_idle() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));
        // Override idle threshold to 0 for testing
        exp.idle_threshold_secs = 0;

        let d = make_disturbance_with_added("A", "B");
        let s1 = exp.record(SigilId::new("Root"), &d, PathBuf::from("a.md")).unwrap();

        // Simulate idle by setting last_entry_at to the past
        exp.last_entry_at = Some(Utc::now() - chrono::Duration::seconds(1));

        let s2 = exp.record(SigilId::new("Root"), &d, PathBuf::from("b.md")).unwrap();
        assert!(s2 > s1, "idle should trigger new session");
    }

    #[test]
    fn test_experience_session_boundary_explicit() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));

        let d = make_disturbance_with_added("A", "B");
        let s1 = exp.record(SigilId::new("Root"), &d, PathBuf::from("a.md")).unwrap();
        exp.end_session();
        let s2 = exp.record(SigilId::new("Root"), &d, PathBuf::from("b.md")).unwrap();
        assert_eq!(s2, s1 + 1);
    }

    #[test]
    fn test_experience_buffer_limit() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));
        exp.buffer_limit = 3;

        let d = make_disturbance_with_added("A", "B");
        for i in 0..5 {
            exp.record(SigilId::new("Root"), &d, PathBuf::from(format!("{i}.md"))).unwrap();
        }

        assert_eq!(exp.buffer_len(), 3);
        // All 5 on disk
        let entries = exp.read_session(exp.session_id()).unwrap();
        assert_eq!(entries.len(), 5);
    }

    #[test]
    fn test_experience_records_sigils_involved() {
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));

        let d = make_disturbance_with_added("Alpha", "Beta");
        exp.record(SigilId::new("Root"), &d, PathBuf::from("a.md")).unwrap();

        let entries = exp.read_session(exp.session_id()).unwrap();
        let sigils: Vec<&str> = entries[0].sigils_involved.iter().map(|s| s.as_str()).collect();
        assert!(sigils.contains(&"Alpha"));
        assert!(sigils.contains(&"Beta"));
    }

    #[test]
    fn test_experience_empty_disturbance_no_record_needed() {
        // An empty disturbance should still record (completeness invariant)
        // but produce zero edge deltas
        let tmp = TempDir::new().unwrap();
        let mut exp = Experience::new(tmp.path().join("journal"));

        let d = Disturbance {
            added_edges: Vec::new(),
            removed_edges: Vec::new(),
            weight_changes: Vec::new(),
            new_sigils: Vec::new(),
            lost_sigils: Vec::new(),
        };
        exp.record(SigilId::new("Root"), &d, PathBuf::from("a.md")).unwrap();

        let entries = exp.read_session(exp.session_id()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].edge_deltas.is_empty());
    }

    #[test]
    fn test_next_session_id_increments() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("journal");
        fs::create_dir_all(&dir).unwrap();

        // Create session files 1, 3 (gap is fine)
        fs::write(dir.join("session-1.jsonl"), "").unwrap();
        fs::write(dir.join("session-3.jsonl"), "").unwrap();

        let next = Experience::next_session_id(&dir);
        assert_eq!(next, 4);
    }
}
