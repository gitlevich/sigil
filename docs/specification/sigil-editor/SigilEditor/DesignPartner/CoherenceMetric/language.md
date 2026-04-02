---
status: idea
---

# Coherence Metric

A number computed from a whole @sigil's shape in @ContrastSpace. Detects drift — when the spec's language no longer agrees with itself after evolution through renames, refinements, and decomposition.

Input: a whole sigil (all language, affordances, invariants, children). Output: a number in an interpretable range. Out of range = coherence violation.

CoherenceMetric checks all projections of a sigil — spec text, code, visuals. One sigil, many projections, one shape. If the projections disagree, the shape is fractured.
