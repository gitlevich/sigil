---
status: implemented
---

# Ontology Tree

This is the !structural-projection of the @sigil. 

It lives in the left panel. Shows the @sigil tree along the structural axis (!structural-projection): branching, depth, parent-child relationships.

Each @sigil is wrapped in a @SigilNode.


I can #search to filter by name, #move or #drag to rearrange, #delete to remove, #add-peer to create a sibling. Cross-cutting affordances (@Editor#navigate, @Editor#rename) are on @Application.

What I see must match what exists: !structural-truth is non-negotiable.

Each @sigil with @affordances has a graphical #affordance-indicator next to the its name label to indicate presence of @affordances, so that i can #navigate directly to an @affordance.

Each @sigil with @invariants #has-an-invariants-icon so that i could click it and see a navigable dropdown of affordances.