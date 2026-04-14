When a sigil's text changes, only its position and the positions of sigils it co-occurs with need to recompute. The rest of the space is stable. This makes the space responsive to edits without requiring a full rebuild on every change.

Violation: a single sigil edit triggers recomputation of the entire space. Or: a changed sigil's position remains stale until a full reindex.