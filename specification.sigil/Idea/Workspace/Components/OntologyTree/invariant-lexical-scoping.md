Only what is in lexical scope is available; what is not is invisible.

In scope for a @Sigil named S:

- children of S
- neighbors of S (same level in the hierarchy)
- sigils connecting S to the root (ancestors on the path, including self and root)
- any name unique within the nearest enclosing subtree: walk outward from S — own subtree, parent's subtree, grandparent's, up to root. First level containing the name wins. If multiple matches exist at the same level, the name is ambiguous and does not resolve.
- sigils in imported ontologies regardless of their level

Children of children require a relative path: if S defines T and T defines U, then `@T@U` is in scope from S.

If a sigil is in scope, so are its invariants and affordances.

When the same name appears at multiple scopes, the innermost definition wins: child before sibling, sibling before ancestor, ancestor before proximity, proximity before imported ontology. Imported ontologies are ambient outer scope; any local definition shadows them. A @Sigil's own children are its most local names.

All name matching is fuzzy: case-insensitive, dashes as word separators, plurals stripped.

When resolution fails due to ambiguity, the error reports candidate locations so the user can write a qualified path.

@OntologyTree enforces this invariant.
