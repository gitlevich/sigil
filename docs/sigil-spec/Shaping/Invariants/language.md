---
status: wip
---
# Invariants

Invariants are the named contrasts I care about within this sigil, each with a preference range along its axis. They define the boundary of this context — not by enumerating what is excluded, but by declaring what has a preference. Everything orthogonal to the declared contrasts is in superposition: unconstrained, freely resolved by whoever implements.

A contrast is a dimension along which I have a preference. "Closed vs open shape" is a contrast. "I prefer closed" is a preference along that axis. Declaring it collapses the superposition in that dimension. Everything else — color, exact shape, size — remains in superposition unless I declare a preference there too.

Invariants are discovered iteratively. I cannot enumerate them fully in advance. When an implementation produces something I did not expect — a color that distracts, a label that is hard to read — I have found a hidden invariant: a preference I held but had not declared. I name the contrast and state my preference. The boundary tightens. The process repeats until implementations I would reject are eliminated.

An accidental gap is an undeclared invariant I am building on. I reference a concept, depend on it, but have not bounded it. It remains in superposition while I treat it as defined. The implementing agent resolves it arbitrarily, and the result surprises me.

Invariants live at every level of the hierarchy — UX, Language, Architecture, Implementation. Each level declares the contrasts relevant to its perspective. A UX invariant might be "the boundary of a context is visible." An architectural invariant might be "reads and writes are separated."
