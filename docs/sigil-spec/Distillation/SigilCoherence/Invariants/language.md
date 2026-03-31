---
status: wip
---
# Invariants

A declared axis — a contrast or property the author explicitly cares about. An invariant defines the membrane along one dimension: it states what must hold regardless of implementation choices, and specifies a preference range along that axis.

Everything orthogonal to the declared invariants is a free dimension. The implementing agent may choose freely there. The author has no preference and will not object to any implementation choice in that space.

Invariants are discovered iteratively. The author cannot fully enumerate them in advance. When an implementation produces something unexpected — a distracting color, a boundary that doesn't read clearly — the author has found a hidden invariant. The surprise is the signal. The invariant is named, the preference range is stated, the membrane tightens in that direction. The process repeats until the agent converges on implementations the author accepts.

**Accidental gap** — an invariant the author implicitly assumed but did not declare. Detected when affordances reference concepts with no specified boundary. The agent fills these gaps arbitrarily.

**Intentional gap** — a free dimension, not a gap. No invariant covers it. I have decided this axis is unconstrained because I have no preferred range on it: I simply don't care.
