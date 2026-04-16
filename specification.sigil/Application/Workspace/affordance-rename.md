---
status: implemented
---
Rename a reference, such as @sigil, affordance (#) or invariant (!) and update all references in the lexical scope, following scoping rules: only the closest to here names are changed. "Here" means in the scope of the sigil on the @language of which I am working. Accessible from any surface — @OntologyTree, @Language, @Atlas.

#rename is a scope-local cascade: the blast radius is bounded by lexical scope, and the commit is immediate. When a rename would cross scope boundaries or touch many @sigils at once, it becomes a reshape and falls under #propose-reshape — the full blast radius is previewed before commit, and the commit is atomic per !reshapes-are-atomic.