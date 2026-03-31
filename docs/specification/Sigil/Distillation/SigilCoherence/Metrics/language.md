---
status: wip
---
# Metrics

Metrics are scalar signals derived from the embeddings of the sigil's trajectories. They are the quantitative face of @SigilCoherence — what you can track over time to know whether the structure is improving.

**@SemanticCoherence** — how well the embedded trajectories cluster around the directions they declare. A coherent sigil has tight intra-sigil clusters, clean boundaries between siblings, and contained sigils that stay within their parent's semantic region.

**@StructuralComplexity** — how tangled the sigil graph is. High complexity makes clean boundaries harder to maintain. Low complexity means each sigil is focused and the relationships between them are sparse.

Each metric is a number between zero and one, computed per sigil and aggregated upward. The root score is the headline. Individual sigil scores show where to focus attention.

Metrics are computed incrementally after each @Burst — when a cluster of edits settles, the affected trajectories are re-embedded and the scores updated. The history of metric values over time is the coherence graph.
