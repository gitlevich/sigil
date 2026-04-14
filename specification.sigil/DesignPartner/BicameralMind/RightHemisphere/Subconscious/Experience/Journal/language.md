---
status: idea
---

# Journal

The append-only record of every exchange between @user and @DesignPartner. Passive. Entries are stored in the order they occurred (!causal-ordering), each session a distinct segment (!session-bounded). The @Subconscious reviews the @Journal during #consolidate and selects what persists into @Memory.
