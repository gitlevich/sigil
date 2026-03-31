---
status: wip
---
# Narrative

Edits are the growth history of a trajectory — the time-like dimension of the sigil. The current text is the trajectory as it stands now. Every change is continuously persisted; there is no save gesture.

The natural unit of growth is a @burst: a cluster of edits close together in time, separated from the next cluster by a meaningful pause. A burst is one session of attention extending the trajectory — adding direction, refining precision, increasing resolution in a patch. It may be a single keystroke or many minutes of continuous narration.

Each burst records: start time, end time, the delta, and the upstream state — what the panels above contained when this burst happened. The upstream state is the trajectory above this level at that moment. When upstream changes, a burst can be evaluated: does it still hold along the new upstream direction, or has the bearing shifted beneath it?

Burst boundaries are detected from the gap distribution of the log itself. Inter-edit gaps are bimodal: short gaps within a burst, long gaps between bursts. The threshold is the valley between modes, recalculated incrementally. Each new write appends one gap sample to a running histogram. Every few minutes the valley is refitted. No full log replay is needed.

The 500ms debounce on file writes is input safety, not a burst boundary.

**What the growth history enables:**

- **Provenance** — every paragraph has a burst that grew it, with a timestamp and the upstream trajectory at that moment
- **Replay** — reapply bursts against a changed upstream; those that conflict with the new direction surface as stale
- **Branching** — fork at any burst to grow the trajectory in a different direction; the tree of explored options is the branching growth history
- **Coherence as diff** — bursts grown before an upstream change and not reconfirmed since are candidates for review
