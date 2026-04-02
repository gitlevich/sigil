---
status: idea
---

# Coherence Metric

A number computed from a whole @sigil's shape in @ContrastSpace (!whole-sigil). Input: a whole sigil. Output: a number in an interpretable range (!numeric). Out of range = the spec's language no longer agrees with itself.

CoherenceMetric detects drift. Each local decision during spec evolution — a rename, a decomposition, a moved affordance — was locally coherent. But the accumulated result may not be. Names written for a concept that was later renamed. Descriptions phrased for a structure that was later reorganized. Icons designed for a term that no longer exists. The metrics catch this: the spec partially describes what it used to be, not what it currently is.

One sigil, many projections (spec, code, visuals), one shape. If the projections disagree, the shape is fractured. CoherenceMetric checks not just spec-against-spec, but spec-against-all-projections. An icon described as "radio signals" but attached to a concept now called "invariant" is a fracture — the visual projection disagrees with the spec.
