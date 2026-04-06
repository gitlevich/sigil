---
status: implemented
---

# Ontology Tree

This is the !structural-projection of the @sigil. 

It lives in the left panel. Shows the @sigil tree along the structural axis (!structural-projection): branching, depth, parent-child relationships.

Each @sigil is wrapped in a @SigilNode.


I can #search-by-name, #move or #drag-and-drop to rearrange, #delete to remove, #add-peer to create a sibling. Cross-cutting affordances (@Workspace#navigate, @Workspace#rename) are on @Workspace.

What I see must match what exists: !structural-truth is non-negotiable.

Each @sigil with @affordances has a graphical #affordance-indicator next to the its name label to indicate presence of @affordances, so that i can #navigate directly to an @affordance.

Each @sigil with @invariants #invariant-indicator so that i could click it and see a navigable dropdown of affordances.