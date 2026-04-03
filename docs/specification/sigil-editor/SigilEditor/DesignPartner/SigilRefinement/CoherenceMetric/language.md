---
status: idea
---

# Coherence Metric

A number computed from a whole @sigil (!whole-sigil). The measured object is the whole sigil as lexical scope: its descendants, affordances, invariants, and imports. @ContrastSpace provides geometric probes over that scoped object. Output: a number in an interpretable range (!numeric). Out of range = the spec's language no longer agrees with itself.

I want to know if a name still fits what it names. I #measure-name-fit: cosine distance from the name to the centroid of its affordances. Drift = the name describes what the sigil used to be.

I want to know if siblings carve the domain at real joints. I #measure-sibling-separation: silhouette score across sibling clusters. Overlap = merge candidates. Internal gap = split candidate.

I want to know if affordances are on the right sigil. I #measure-affordance-affinity: distance-to-parent vs distance-to-nearest-uncle. Above 1 = misplaced.

I want to know if invariants describe the actual boundary. I #measure-boundary-sharpness: subspace alignment between invariant embeddings and content embeddings. Low = aspirational, not structural.

I want to know if the language is compensating for wrong structure. I #measure-language-flow: word count per affordance, normalized against depth. Many words = the model is wrong.

Each local decision during spec evolution — a rename, a decomposition, a moved affordance — was locally coherent. But the accumulated result may not be. Names written for a concept that was later renamed. Descriptions phrased for a structure that was later reorganized. Icons designed for a term that no longer exists. The metrics catch this: the spec partially describes what it used to be, not what it currently is.

One sigil, many projections (spec, code, visuals), one shape. If the projections disagree, the shape is fractured. CoherenceMetric checks not just spec-against-spec, but whether the projections still agree about the same scoped object. I #track-over-time: snapshot all metrics on each commit. Converging spec = metrics tightening. Drifting spec = metrics degrading after changes that haven't settled.
