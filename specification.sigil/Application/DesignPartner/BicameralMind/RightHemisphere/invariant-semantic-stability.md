# semantic-stability

A @sigil's identity is its conceptual geometry, not its wording. Paraphrase, sentence reordering, formatting cleanup, and other surface rewrites that leave the geometry intact do not create a new remembered @sigil. They do not trigger escalation. Two texts that say the same thing in different words are the same @sigil.

This means the disturbance signal must operate on structure extracted from text, never on the text itself. Raw character-level or token-level diff is not a valid input to disturbance. The mechanism must first resolve what a passage means in terms of @shape and @invariant relations, then compare at that level.

Violation: a reworded paragraph registers as a new or changed @sigil despite no change in concepts, relations, or boundaries.
