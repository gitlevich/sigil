---
status: wip
---
# EditLog

A panel is not a document — it is a sequence of edits. The current text is the result of replaying that sequence. Every change is continuously persisted; there is no save gesture.

The natural unit of the log is a **burst**: a cluster of edits close together in time, separated from the next cluster by a meaningful pause. A burst captures one session of thought about this sigil at this level. It may be a single keystroke or many minutes of continuous editing.

Each burst records: start time, end time, the delta (what changed), and the upstream state at the time — what the panels above contained when this burst happened. This reference to upstream state is what makes replay possible: when UX changes, Language bursts can be replayed against the new UX to identify which decisions still hold and which conflict.

**Burst detection** is derived from the gap distribution of the log itself. Inter-edit gaps follow a bimodal distribution: short gaps within a burst, long gaps between bursts. The valley between the two modes is the threshold. It is recalculated incrementally: a running histogram of inter-edit gaps is maintained alongside the log. Each new write appends one gap sample. Every few minutes the valley is refitted from the updated histogram. No full log replay is needed — just one new sample and a refit.

The 500ms debounce on file writes is a separate, lower-level rhythm — input safety to avoid thrashing the filesystem. It is not semantically meaningful and does not define burst boundaries.

**What the log enables:**

- **Provenance** — every paragraph has a burst that produced it, with a timestamp and upstream context
- **Replay** — reapply bursts against a changed upstream; conflicts surface as stale decisions
- **Branching** — fork at any burst to explore an alternative direction; the tree of explored options is the branching burst history
- **Coherence as diff** — bursts written before an upstream change and not confirmed since are candidates for review
