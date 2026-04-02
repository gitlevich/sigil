---
status: idea
---

# Detect Missing Contrast

Given a sigil's affordances, embed them and look at the region they span in embedding space. If the affordances cover a region that has obvious directional gaps — axes along which you'd expect discrimination but find none — this may indicate a missing @contrast in the sigil's boundary.

A sigil is closed over the contrasts relevant within it. If affordances imply a contrast that no invariant addresses, the sigil may be under-constrained along that dimension. The implementing agent would have to guess what the preference is.

This is the hardest metric to compute because "obvious gap" requires knowing what the expected shape should be. But even a simple heuristic — affordances that span a direction without a corresponding invariant — would surface useful questions.
