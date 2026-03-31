---
status: wip
---
# Atlas

The Atlas — a collection of maps, one per sigil. Each map shows the sigil at its own scale: the sigil fills the area, its contained sigils are named cells, everything deeper is anonymous shape — recursive subdivision visible as texture, conveying density and resolution without text. Entering a contained sigil opens its map at the same scale.

Relationships between neighbors are edges connecting the named cells.

Invariants for every cell: a closed boundary with a name. The name is visually unambiguous about which cell it belongs to and does not occlude the interior. Shape and color are free.

@FocusedMode shows one level of containment at a time. @RevealedMode shows the full recursive structure.
