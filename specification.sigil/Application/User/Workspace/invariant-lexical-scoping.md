Only what is in lexical scope is available; what is not is invisible.

In scope for a @Sigil:
- itself — its own @affordances and @invariants
- its children — their @Sigil#names, @affordances, and @invariants (but not their children — those are private)
- its siblings — their @Sigil#names, @affordances, and @invariants (but not their children)
- ancestors — walking up, each ancestor and its children (one level deep): their @Sigil#names, @affordances, @invariants
- root scope includes imported ontologies (Libs) — ambient, visible everywhere

When the same name appears at multiple scopes, the innermost definition wins: child before sibling, sibling before ancestor, ancestor before imported ontology. A @Sigil's own children are its most local names.

Visibility is exactly one level deep into any neighbor or child. You see a @Sigil's surface but not its internals. This is the @Sigil boundary.

@Narrating enforces this invariant.
