---
status: wip
---
# Map

The Map — a rectangular treemap expressing the structure of the open sigil spatially. The open sigil fills the area. The sigils it contains are named cells. Everything deeper is anonymous shape: recursive subdivision visible as texture, conveying density and resolution without text.

Relationship edges render between the named level's cells.

Invariants for every cell: a closed boundary with a name. The name is visually unambiguous about which cell it belongs to and does not occlude the interior. Shape and color are free.

@FocusedMode shows one level of containment at a time. @RevealedMode shows the full recursive structure.
