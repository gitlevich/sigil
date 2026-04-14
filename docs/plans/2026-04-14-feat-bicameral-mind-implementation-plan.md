---
title: "Implement BicameralMind runtime from spec"
type: feat
status: completed
date: 2026-04-14
---

# Implement BicameralMind Runtime

Replace the entire `src-tauri/src/memory/` module with a new `src-tauri/src/bicameral_mind/` module built from the BicameralMind specification. The old code was built before the spec existed and has the wrong architecture: neural embeddings (AllMiniLML6V2), LLM-driven concept extraction, cosine similarity search. The spec defines co-occurrence geometry, no neural models, no network for RightHemisphere.

## Enhancement Summary

**Deepened on:** 2026-04-14
**Research agents used:** architecture-strategist, performance-oracle, pattern-recognition-specialist, code-simplicity-reviewer, spec-flow-analyzer, graph-algorithms-researcher, rust-async-researcher

### Key Improvements
1. Dropped sphere positioning algorithm (MDS/force-directed) — graph edges ARE the geometry, distance = 1/weight
2. Collapsed 7 phases to 3 MVP phases + 3 deferred phases — working disturbance detection first
3. Event-driven RightHemisphere (file-save events via channels), not polling
4. Concrete crate choices: petgraph, notify-debouncer-full, tokio::sync::watch
5. Added missing edge cases: empty project, API failure, file deletion, session boundaries

### Critical Design Decisions from Research
- **No coordinate embedding.** ContrastSpace is the weighted graph itself. Distance between sigils = inverse co-occurrence weight. No MDS, no force-directed layout. Add coordinates later only if Atlas visualization needs them, computed asynchronously.
- **Snapshot-based reads.** RightHemisphere works on a cloned snapshot of geometry, not a shared mutable reference. Eliminates lock contention between watcher updates and continuous attention.
- **Single Relevance implementation.** One parameterized filter used by both RightHemisphere (scope: live shapes) and Subconscious (scope: Experience segments). Honors the `single-mechanism` invariant.
- **Event-driven, not polling.** File-save events → mpsc channel → debounce task → geometry update → watch channel. Zero CPU when user not saving.
- **One LH turn = one HTTP call.** Gate sends prompt with lexical scope, LH returns response, Gate calls map-check. Bounded-turn is a counter of HTTP round-trips. Wall-clock timeout (30s) per call.

## Problem Statement

The existing memory system (8 files, ~1753 lines) uses:
- `fastembed` with AllMiniLML6V2 for vector embeddings
- SQLite with cosine similarity for nearest-neighbor search
- LLM-driven concept extraction (memorizer.rs calls Claude API)
- Consolidation via weight decay and similarity-based merging

The spec defines something fundamentally different:
- Co-occurrence geometry from sentence-level @reference co-occurrence
- Sigils as spheres positioned by entanglement distances
- No neural models, no network for RightHemisphere
- Memory as graph connectivity, decay as disconnection
- CorpusCallosum as structural compression (not neural)
- LeftHemisphere as remote LLM with bounded turns

## Proposed Solution

Delete `src-tauri/src/memory/` entirely. Build `src-tauri/src/bicameral_mind/` from spec invariants. MVP in 3 phases (co-occurrence graph, disturbance detection, Tauri wiring). Deferred phases for Memory consolidation, CorpusCallosum gating, and LeftHemisphere integration.

Both modules coexist during development. Old module serves traffic. New module is test-only until the swap in Phase 3.

## Technical Approach

### Types and Conventions

```rust
// bicameral_mind/types.rs — shared types, no primitive obsession

/// Newtype for sigil names used as graph keys. Prevents passing arbitrary strings.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Ord, PartialOrd)]
struct SigilId(String);

/// A sigil as seen from outside — a sphere in ContrastSpace.
struct SigilSphere {
    id: SigilId,
    affordances: Vec<Affordance>,  // reuse from models/sigil.rs
    invariants: Vec<Invariant>,    // reuse from models/sigil.rs
    content_volume: usize,         // bytes of content (radius proxy)
}

/// Weighted edge: two sigils co-occurring in sentences.
struct CoOccurrence {
    a: SigilId,
    b: SigilId,
    weight: f32,                          // repetition count
    sources: Vec<(PathBuf, usize)>,       // (file, line) — lazy text retrieval
}

/// The geometry. No coordinates — distances computed from edge weights.
struct ContrastSpace {
    graph: petgraph::UnGraph<SigilId, f32>,  // weighted undirected graph
    spheres: HashMap<SigilId, SigilSphere>,
    file_edges: HashMap<PathBuf, Vec<EdgeIndex>>,  // per-file edge tracking for incremental removal
}

/// Error type for the module, extended per phase.
enum BicameralError {
    ParseError(String),
    GraphInconsistency(String),
    ApiError(String),       // Phase 4+
    GateViolation(String),  // Phase 4+
}
```

### Module Structure

Sub-modules mirror the spec hierarchy. Start with 5 files, split when any exceeds 300 lines.

```
src-tauri/src/bicameral_mind/
  mod.rs              — orchestrator, Tauri state, public API
  types.rs            — SigilId, SigilSphere, CoOccurrence, ContrastSpace, BicameralError
  co_occurrence.rs    — parse @references, build graph, incremental update
  right_hemisphere.rs — disturbance detection, relevance filter, continuous attention
  experience.rs       — append-only journal (Phase 2+)
```

Deferred files (Phase 4+):
```
  memory.rs           — geometric storage, recognition, decay, consolidation
  corpus_callosum.rs  — gate, narration, escalation threshold
  left_hemisphere.rs  — remote LLM, vocabulary-bounded, stateless
```

### Phase 1: CoOccurrenceGeometry + Disturbance Detection (MVP Core)

Without geometry, nothing else works. This phase delivers the foundation AND the sensing loop.

**What to build:**
- `co_occurrence.rs` — Parse @references from spec .md files at sentence level. Build weighted edge graph via petgraph. Track per-file edge contributions for incremental removal. Distance between any two sigils = 1/weight (no positioning algorithm).
- `right_hemisphere.rs` — Event-driven: receives file-change events via `tokio::sync::mpsc`, debounces via `notify-debouncer-full` pattern (200ms settle), recomputes affected edges, publishes new geometry snapshot via `tokio::sync::watch`. Detects disturbance by comparing old and new edge sets. Applies relevance filter (shapes with no affordances = noise).
- `types.rs` — Shared types as defined above.
- `mod.rs` — Wires file watcher → mpsc → RH task. Exposes `watch::Receiver<Arc<ContrastSpace>>` for Tauri commands.

**Architecture (from research):**

```
notify file watcher (existing watcher.rs pattern)
  → tokio::sync::mpsc::channel  (file change events)
  → spawned tokio task: debounce (200ms settle via tokio::time::sleep reset)
    → reparse changed file only
    → remove old edges for that file (file_edges map)
    → insert new edges
    → compare old snapshot vs new → disturbance signal
    → relevance filter (has affordances?)
    → publish via tokio::sync::watch
  → Tauri commands call watch::Receiver::borrow() for current state
```

**Invariants to satisfy:**
- `always-on`: Graph built at app start from all spec files. RH task spawned before UI loads.
- `no-network`: Entirely local. petgraph + regex.
- `non-blocking`: All processing in spawned tokio task. Editor never blocks.
- `semantic-stability`: Disturbance operates on edge delta, not text diff. Rewording preserving @refs = zero edge change = zero disturbance.
- `conceptual-salience`: Edge removal (lost @reference) produces disturbance. Edge weight change (moved @reference to different sentence) produces disturbance proportional to weight delta.

**Edge cases (from spec-flow analysis):**
- **Empty project:** Empty graph, RH active but attending nothing. First @reference creates first node. Geometry builds organically. `always-on` satisfied (it IS on, just nothing to see yet).
- **File deleted during parse:** Graceful skip (file-not-found → remove all edges for that file from graph, not panic).
- **Rapid saves:** Debounce coalesces into single geometry update. Frequency-filtering at escalation level (Phase 4) is separate from debounce at parse level.
- **Race between saves:** Updates serialized through mpsc channel. Only one geometry update in flight at a time.

**Crates:**
- `petgraph` — weighted undirected graph
- `regex` — sentence splitting on `[.!?]\s+`, @reference extraction `@(\w+)`
- Existing `notify` + add debounce logic (or `notify-debouncer-full`)

**Tests first:**
- `test_sentence_co_occurrence_extraction` — two @refs in same sentence → edge with weight 1
- `test_paragraph_no_co_occurrence` — @refs in different sentences → no edge
- `test_transitive_irrelevance` — A↔B, B↔C but no A↔C co-occurrence → no A↔C edge
- `test_repetition_strengthens` — same pair in 3 sentences → weight 3
- `test_distance_inverse_weight` — distance(A,B) = 1/weight(A,B)
- `test_incremental_update_add_file` — new file adds edges without full rebuild
- `test_incremental_update_remove_file` — deleted file removes only its edges
- `test_incremental_update_modify_file` — changed file: remove old edges, add new ones
- `test_rewording_no_disturbance` — same @refs, different words → edge set unchanged → no signal
- `test_removed_reference_disturbance` — @ref deleted from sentence → edge removed → signal
- `test_relevance_filter_no_affordances` — sigil with no affordances → filtered from disturbance
- `test_empty_project_startup` — zero files → empty graph, no crash, RH active
- `test_first_reference_creates_geometry` — first file with @ref → first node + edges
- `test_file_deleted_during_parse` — file vanishes → edges removed, no panic
- `test_debounce_rapid_saves` — 10 saves in 100ms → one geometry update

**Files:**
- `src-tauri/src/bicameral_mind/mod.rs`
- `src-tauri/src/bicameral_mind/types.rs`
- `src-tauri/src/bicameral_mind/co_occurrence.rs`
- `src-tauri/src/bicameral_mind/right_hemisphere.rs`

### Phase 2: Experience + Subconscious Filtering

**What to build:**
- `experience.rs` — Append-only JSONL journal of exchanges. One file per session. Causal ordering by timestamp. Session boundary = app close OR 30 minutes of zero edits. Bounded in-memory window (last 1000 entries), older entries on disk only.
- Extend `right_hemisphere.rs` with Subconscious filtering: same Relevance filter, parameterized by scope (live shapes vs Experience segments). Filter test: does burst involve sigils entangled with active invariants of currently open sigil?

**Invariants to satisfy:**
- `single-mechanism`: One `RelevanceFilter` struct, called with different scope parameter.
- `affordance-relevance`: Relevant = sigils whose affordances entangled with active invariants.
- `relevance-gating`: Children (always relevant), neighbors (dependency risk), parent (laws of nature).
- `no-escalation`: Subconscious never produces escalation signal.
- `append-only`, `causal-ordering`, `session-bounded`, `complete` for Experience.

**Session boundary heuristic:** Session ends when app closes (Tauri `on_window_event` close) or after 30 minutes idle (no file-save events). On boundary: flush in-memory buffer to disk, increment session counter.

**Experience entry format:**
```rust
struct ExperienceEntry {
    timestamp: DateTime<Utc>,
    session_id: u64,
    sigils_involved: Vec<SigilId>,     // which sigils were in the edit
    active_sigil: SigilId,             // currently open sigil
    edge_deltas: Vec<EdgeDelta>,       // what changed in geometry
    source_file: PathBuf,
}
```

**Tests first:**
- `test_experience_append_only` — entries never modified or deleted
- `test_experience_causal_order` — entries retrievable in insertion order
- `test_experience_session_boundary_idle` — 30min idle → new session
- `test_experience_session_boundary_close` — app close → session ends
- `test_filtering_entangled_passes` — burst with co-occurring sigils → promoted
- `test_filtering_unentangled_blocked` — burst with no co-occurrence → stays
- `test_children_always_relevant` — child sigil activity → always relevant
- `test_parent_change_high_relevance` — parent affordance change → high relevance
- `test_no_escalation` — Subconscious never produces escalation signal
- `test_relevance_filter_same_for_filtering_and_consolidation` — single-mechanism check

**Files:**
- `src-tauri/src/bicameral_mind/experience.rs`
- Extend `right_hemisphere.rs` with relevance parameterization

### Phase 3: Wire to Tauri + Delete Old Module

**What to build:**
- Replace old Tauri commands. Full audit of call sites:
  - `memory_recall_for_sigil` → `bicameral_recall_for_sigil` (vocabulary retrieval from graph neighbors)
  - `memory_status` → `bicameral_status` (graph stats, session info, last consolidation)
  - `memory_trigger_reindex` → `bicameral_trigger_reindex` (full graph rebuild)
  - `memory_trigger_sleep` → `bicameral_trigger_sleep` (force consolidation — stub until Phase 5)
  - `read_memories` → `bicameral_read_graph` (nodes + edges for Atlas visualization)
  - `send_chat_message` integration in `commands/chat.rs` — replace recall call
- Delete `src-tauri/src/memory/` entirely (8 files, ~1753 lines).
- Remove `fastembed` from Cargo.toml. Check if `rusqlite` used elsewhere before removing.
- Add `petgraph` to Cargo.toml.

**No feature flags.** Both modules coexist during Phases 1-2, old serves traffic, new is test-only. Phase 3 swaps in one commit and deletes the old module. The architectures are incompatible — no gradual migration path.

**Tests first:**
- `test_bicameral_status_returns_graph_stats` — Tauri command returns node/edge counts
- `test_bicameral_recall_returns_vocabulary` — query by sigil → returns neighbors + affordances + invariants
- `test_bicameral_read_graph_matches_contrast_space` — Atlas data matches internal state
- `test_app_compiles_without_memory_module` — old module fully removed, clean build

**Files:**
- `src-tauri/src/bicameral_mind/mod.rs` (add Tauri command handlers)
- `src-tauri/src/lib.rs` (rewire managed state + command registration)
- `src-tauri/src/commands/chat.rs` (replace recall integration)
- DELETE `src-tauri/src/memory/` (all 8 files)

### Deferred: Phase 4 — Memory (Geometric Storage + Recognition + Decay + Consolidation)

Build after MVP proves the sensing loop works. Memory is the co-occurrence graph itself. Remembered sigil = node with edges. Decay = multiplicative weight reduction (0.9x) on untouched edges during consolidation. Lazy deletion below threshold. Recognition = nearest node by inverse-weight distance. Consolidation during sleep reinforces attended edges, merges always-co-occurring nodes.

### Deferred: Phase 5 — CorpusCallosum (Gate + Narration)

Build after Memory. Gate enforces bounded turns (counter of HTTP round-trips, hard cap). Map-check after each turn (RH re-senses, compares to pre-escalation snapshot). Frequency filtering via `VecDeque<Instant>` bounded at 256 entries. Amplitude threshold adaptive to workspace noise (start sensitive, increase with baseline editing rate). Coherence checked before any escalation.

### Deferred: Phase 6 — LeftHemisphere (Remote LLM)

Build after CorpusCallosum. One HTTP call per turn via reqwest + Claude API. 30s wall-clock timeout via `tokio::time::timeout`. Exponential backoff on failure (max 3 retries, then suppress that escalation, log it). Vocabulary bounding enforced post-generation: validate output references are within lexical scope, reject if not. Graceful degradation to RH-only mode during API outage.

## Acceptance Criteria

### Phase 1: CoOccurrenceGeometry + Disturbance Detection
- [x] @reference co-occurrence extracted at sentence level from all spec .md files
- [x] Weighted edge graph built (HashMap + Vec, no petgraph needed at this scale)
- [x] Per-file edge tracking for incremental add/remove/modify
- [x] Distance = 1/weight, no coordinate embedding
- [x] Event-driven: file-save → mpsc → debounce → geometry update → watch channel
- [x] Disturbance = edge set delta between snapshots
- [x] Rewording preserving @refs = zero disturbance
- [x] Structural edits (removing/adding @refs) = disturbance proportional to weight delta
- [x] Relevance filter: no affordances = noise
- [x] Empty project: empty graph, no crash
- [x] File deletion: edges removed gracefully
- [x] All processing non-blocking, no network

### Phase 2: Experience + Subconscious
- [x] Append-only JSONL journal, one file per session
- [x] Session boundary: app close OR 30min idle
- [x] Causal ordering by timestamp
- [x] Single RelevanceFilter parameterized by scope
- [x] Children always relevant, parent = high relevance
- [x] Subconscious never escalates

### Phase 3: Tauri Wiring + Old Module Deletion
- [x] All 6 old Tauri commands replaced with new ones
- [x] send_chat_message recall path updated
- [x] Old memory module deleted (8 files)
- [x] fastembed removed from Cargo.toml
- [x] Clean build, all existing tests pass

## Dependencies & Risks

**Dependencies:**
- Compiler's reference parser (reuse existing `@(\w+)` pattern)
- Tauri async runtime (tokio — already in use)
- Existing file watcher (notify — extend with debounce)
- petgraph (new dependency, well-maintained, 5k+ GitHub stars)

**Risks:**
- Co-occurrence geometry is novel — no existing library for the full pipeline. Mitigated by using petgraph for the graph and keeping the geometry simple (no coordinate embedding).
- Large deletion (1753 lines) could break hidden integration points. Mitigated by full audit of call sites before Phase 3.
- Deferred phases (Memory, CorpusCallosum, LeftHemisphere) are substantial features. Mitigated by MVP proving the sensing loop first — if it works, the rest follows spec invariants.

**Not risks:**
- Scale. Current workspace: 228 files, 443 references. Graph operations are sub-millisecond. Even at 10x, everything is fast.
- Feature flags. Not needed. Architectures are incompatible. Build alongside, swap once.

## Sources

- Specification: `specification.sigil/DesignPartner/BicameralMind/` (70+ files)
- Existing code: `src-tauri/src/memory/` (8 files, ~1753 lines — to be deleted)
- Existing watcher: `src-tauri/src/commands/watcher.rs` (notify pattern to follow)
- Memory notes: `project_bicameral_architecture.md`, `session_bicameral_implementation_ready.md`
- Crates: petgraph, notify-debouncer-full, tokio::sync::{watch, mpsc}
