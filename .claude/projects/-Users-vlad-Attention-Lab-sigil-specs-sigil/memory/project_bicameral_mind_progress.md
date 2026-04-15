---
name: Bicameral Mind implementation progress
description: Current state of RightHemisphere implementation — SigilSpace done, continuous-attention next
type: project
---

SigilSpace is implemented in `packages/sigil-core/src/sigilSpace.ts` on branch `feat/bicameral-mind-v2`. It's a local refinement of ContrastSpace from the spec — the sigil tree seen as a co-occurrence graph. Nodes are sigils, edges are sentence co-occurrence counts. All ContrastSpace affordances (#place, #neighbors, #displacement, #distance) and invariants (!complete, !co-occurrence-grounded, !vocabulary-attached, !incremental) are covered. 21 tests in `tests/sigil-core/sigilSpace.test.ts`.

**Why:** Building the RightHemisphere bottom-up because top-down was too complex. SigilSpace is the foundation everything else rests on.

**How to apply:** Next step is `#continuous-attention` — the watcher that detects displacement when sigils change. It consumes SigilSpace and produces displacement signals for Subconscious#filtering and EscalationThreshold. Spec path: `DesignPartner/BicameralMind/RightHemisphere/affordance-continuous-attention.md`. Use `/read-sigil DesignPartner/BicameralMind/RightHemisphere` to load the full spec context.

Key design decision: Position from the spec was dropped as redundant — a sigil already has name, affordances, invariants (vocabulary). Its "position" is just its edges in the co-occurrence graph.

Also added `scripts/read-sigil.ts` and `.claude/skills/read-sigil.md` — reads a sigil subtree as one JSON object instead of dozens of file reads.
