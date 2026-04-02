---
status: idea
---

# Measure Sibling Separation

Silhouette score across sibling @sigil clusters in @ContrastSpace. Each sibling's content (name, language, affordances, invariants) forms a cluster. Range: -1 (wrong cluster assignment) through 0 (overlapping) to 1 (well-separated). High score = siblings carve the domain at real joints. Low score = siblings overlap and may need merging. Internal gap within one sibling's cluster suggests it should split.
