# geometric-superiority

The geometric mechanism must produce more accurate disturbance judgments than simple baselines: raw text-diff size, keyword overlap, and path-local heuristics. Accuracy is measured against labeled edit histories where a human has judged which edits are structurally significant and which are cosmetic.

This invariant exists because geometric analysis is expensive. If a naive baseline performs equally well, the geometric approach is not justified. The mechanism earns its complexity by handling cases the baselines get wrong: large cosmetic diffs that should be quiet, small structural breaks that should be loud, and cross-sigil effects that path-local heuristics miss entirely.

Violation: the mechanism agrees with a text-diff-size baseline on every case in the labeled set, providing no evidence that geometric analysis adds value.
