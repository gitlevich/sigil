---
status: idea
---

# Detect Missing Contrast

PCA on affordance embeddings gives axes of variation. For each principal component, measure the maximum projection of any @invariant embedding onto it. An axis with high affordance variance but no invariant projection is unconstrained — the @sigil's affordances vary along a @contrast that no invariant addresses. Output: count of unconstrained axes (threshold: invariant projection below a configurable minimum). Zero = fully constrained. Nonzero = the implementing agent would have to guess the @preference along those axes.
