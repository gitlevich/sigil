---
status: wip
---
# Affordance

An affordance is a capability that a sigil makes visible across its boundary. It is not what happens inside — it is what can be addressed from outside. Every affordance belongs to a sigil — I cannot name a capability without naming who exposes it: to open a door I use the affordance of a door handle attached to it. This is how sigils get their names: whenever I articulate an affordance, I need a subject.

I cannot reach inside another sigil. I can only address it by name and use what it exposes. If I need to reach deeper, the boundary is wrong. The five-sigil limit bounds the complexity of any context's affordance surface. If a sigil exposes too many affordances, it needs to be decomposed further.

Affordances are referenced in two directions:

- **Down** — a containing sigil addresses the affordances of the sigils it contains. The container's domain language is woven from their names and their affordances.
- **Across** — a neighbor's affordance is addressed with the notation `@Neighbors.affordance`, referencing a capability from within my own context.

Neighbor names and affordance references are visually distinct in the language. The `@` notation signals a reference to a neighbor or its capability.

