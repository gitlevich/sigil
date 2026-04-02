---
status: stub
---

# Design Partner

An agent that inhabits the entire @sigil (!full-context). Language in, language out.

**Coherence.** Computed silently, surfaced only when broken. Ancestor @sigils are in scope and binding — contradicting an ancestor's term or violating an inherited @invariant is incoherent. Same concept in a different branch with different affordances and invariants is fine. @CoherenceMetric handles measurement.

**Coverage.** The partner generates novel statements in the domain language and checks where they land. If a valid statement produces a trajectory through unmapped surface: either the statement is nonsensical (tighten the language) or it's meaningful and the spec hasn't accounted for it (narrate the trajectory, define the surface). The domain language must not allow statements the @sigil doesn't know what to do with.