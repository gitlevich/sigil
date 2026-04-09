---
status: idea
---

# Implementation

This is where we address the how of @Experience.

@Experience is an append-only record of every exchange between @user and @DesignPartner. It feeds two paths. The live path: new text is embedded into @ContrastSpace immediately and @Sight sees it. The consolidation path: the @Subconscious reviews it during #consolidate and selects what persists into @Memory.

@Experience does not offer affordances. It is passive. Its value is that it is !complete and !append-only.

Acceptance criteria:

!causal-ordering — entries are stored in the order they occurred

!session-bounded — each session is a distinct segment
