---
status: idea
---

# Implementation

This is where we address the how of @SpellExecution.

A spell fires when @Sight #recognizes a @sigil that has a matching entry in the @Spellbook. Recognition is the trigger — no separate condition evaluation. The procedure defined in the @Spellbook executes. No generation, no judgment.

Successful execution stays within the @RightHemisphere. Failed execution escalates through the @CorpusCallosum. A spell that fails means the world shifted in a way the @Spellbook didn't account for. That's a disturbance the @LeftHemisphere needs to resolve.

Acceptance criteria:

!deterministic — same input produces same output, no generation in the execution path

!failure-escalates — a failed spell triggers escalation through the @CorpusCallosum

!spellbook-complete — every spell defined in the @Spellbook is matchable and invocable
