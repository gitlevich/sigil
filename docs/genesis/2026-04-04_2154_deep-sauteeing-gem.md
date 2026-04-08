# Session: deep-sauteeing-gem
**Date**: 2026-04-04 21:54 UTC  
**Source**: Claude  
**Session ID**: `04026bef-77c1-49cf-8f08-96bca52fd82f`

---

### Assistant (21:54 UTC)

Found the DesignPartner sigil. Let me read it comprehensively.

### Assistant (22:01 UTC)

Let me read the key files directly.

### Assistant (22:01 UTC)

*Files: [docs/specification/sigil-editor/Application/DesignPartner/language.md](../../docs/specification/sigil-editor/Application/DesignPartner/language.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-get-to-know.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-get-to-know.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-wear-my-sigil.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-wear-my-sigil.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-chat.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-chat.md), [docs/specification/sigil-editor/Application/DesignPartner/invariant-always-tell-the-truth.md](../../docs/specification/sigil-editor/Application/DesignPartner/invariant-always-tell-the-truth.md), [docs/specification/sigil-editor/Application/DesignPartner/invariant-keep-a-spellbook.md](../../docs/specification/sigil-editor/Application/DesignPartner/invariant-keep-a-spellbook.md), [docs/specification/sigil-editor/Application/DesignPartner/invariant-full-access.md](../../docs/specification/sigil-editor/Application/DesignPartner/invariant-full-access.md)*

Now let me read the SigilRefinement and other key sub-sigils, plus the read/write affordances and memory system.

### Assistant (22:01 UTC)

*Files: [docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/language.md](../../docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/language.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-read-tree.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-read-tree.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-read-sigil.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-read-sigil.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-write-sigil.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-write-sigil.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-remember.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-remember.md), [docs/specification/sigil-editor/Application/DesignPartner/Memory/language.md](../../docs/specification/sigil-editor/Application/DesignPartner/Memory/language.md)*

Now let me read the Coherence sub-sigil and a few more key affordances.

### Assistant (22:01 UTC)

*Files: [docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/Coherence/language.md](../../docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/Coherence/language.md)*

Now let me read the Coverage sigil and the Spellbook reference, plus check existing skills for format reference.

### Assistant (22:01 UTC)

*Files: [docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/Coherence/Coverage/language.md](../../docs/specification/sigil-editor/Application/DesignPartner/SigilRefinement/Coherence/Coverage/language.md), [.claude/skills/create-sigil.md](../../.claude/skills/create-sigil.md)*

Now I have enough. Let me create the DesignPartner skill.

### Assistant (22:02 UTC)

*Files: [docs/specification/sigil-editor/Application/DesignPartner/affordance-set-timer.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-set-timer.md), [docs/specification/sigil-editor/Application/DesignPartner/affordance-browser-state-inspection.md](../../docs/specification/sigil-editor/Application/DesignPartner/affordance-browser-state-inspection.md)*

Now I'll create the skill.

### Assistant (22:09 UTC)

*Files: [.claude/skills/design-partner.md](../../.claude/skills/design-partner.md)*

Created `.claude/skills/design-partner.md`. You can invoke it with `/design-partner`.

The skill inhabits the DesignPartner sigil: it grounds itself in the actual spec tree on first turn, thinks in the McGilchrist hemispheric cycle (Coherence sensing, then Coverage tracing, then re-sensing), uses the spatial probes (name-fit, sibling-separation, affordance-affinity, boundary-sharpness, language-flow), reads/writes the spec directly, and persists memory across sessions. It holds all three invariants: full-access, always-tell-the-truth, and keep-a-spellbook.
