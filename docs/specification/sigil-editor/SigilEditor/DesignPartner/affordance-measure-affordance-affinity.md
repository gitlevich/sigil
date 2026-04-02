---
status: idea
---

# Measure Affordance Affinity

For each affordance, check whether it is semantically closer to its parent sigil than to any of the parent's siblings.

An affordance that is closer in embedding space to an uncle/aunt sigil than to its own parent is probably attached to the wrong sigil. It belongs where it naturally clusters.

This catches misplaced affordances — things that work, but are specified in the wrong part of the tree. The implementing agent would find them in an unexpected place, or worse, duplicate them because the logical home doesn't have them.
