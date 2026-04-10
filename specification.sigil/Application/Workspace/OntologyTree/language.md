---
status: implemented
---

# Ontology Tree

The sigil tree. Aggregate root of @SigilNodes. Owns !lexical-scoping: what names are visible from any position is determined by the tree structure.

Shows the @sigil along the structural axis (!structural-projection): branching, depth, parent-child relationships. Lives in the left panel.

Each @sigil is wrapped in a @SigilNode.

I can #search-by-name, #move or #drag-and-drop to rearrange, #delete to remove, #add-peer to create a sibling. Cross-cutting affordances (@Workspace#navigate, @Workspace#rename) are on @Workspace.

What I see must match what exists: !structural-truth is non-negotiable.

Each @sigil with @affordances has a graphical #affordance-indicator next to the its name label to indicate presence of @affordances, so that i can #navigate directly to an @affordance.

Each @sigil with @invariants #invariant-indicator so that i could click it and see a navigable dropdown of affordances.

I can #zoom-into a @sigil, so that I am not distracted by the surroundings not relevant to what I am observing.