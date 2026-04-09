Only what is in lexical scope is available; what is not is invisible.

In scope for a @Sigil named S
- children of S
- children of children of S when expressed as a relative path, eg if S defines T, T defines U, then within the scope of S, expression `@T@U` is in scope
- neighbors of S (same level in the hierarchy)
- sigils connecting S the root
- sigils in imported ontologies regardless of their level

If a sigil is in scope, so are its invariants and affordances.

When the same name appears at multiple scopes, the innermost definition wins: child before sibling, sibling before ancestor, ancestor before imported ontology. A @Sigil's own children are its most local names.

@Narrating enforces this invariant.
