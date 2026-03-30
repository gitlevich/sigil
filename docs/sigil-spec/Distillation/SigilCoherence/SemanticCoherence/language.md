---
status: wip
---
# SemanticSigilCoherence

How well the embedding reflects the membrane of a sigil.

Each sigil is embedded by its vision — what it is. Each affordance is embedded with its full ancestor context prepended as natural language, situating its meaning within the containment hierarchy. The embedding unit is the sigil, represented by two things: its vision (the sigil's identity) and its affordances (points shaped by ancestor context).

**Name-affordance alignment** — the sigil's name is embedded standalone and compared to the centroid of its affordances. If the name's embedding sits far from the centroid, the name is lying: it claims to be one thing but contains another. A name that is too broad (e.g. "Core") produces trivially high coverage with no discriminating signal.

**Intra-sigil scatter** — if affordance points spread in many directions from the vision point, the sigil is confused about what it is. It is trying to be multiple things.

**Boundary separation** — neighboring sigils should have distinct, non-overlapping membrane regions. Overlap means the boundary between them is underspecified.

**Containment** — a contained sigil's affordances should cluster within its parent's semantic region. If a child drifts outside, it may be in the wrong place in the hierarchy.

**Gaps on declared axes** — if declared invariants cover an axis and the affordance embeddings do not resolve it at the required precision, the membrane has an open edge there. The implementing agent has degrees of freedom at that edge and will fill it arbitrarily.
