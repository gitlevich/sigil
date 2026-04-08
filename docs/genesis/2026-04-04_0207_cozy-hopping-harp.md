# Session: cozy-hopping-harp
**Date**: 2026-04-04 02:07 UTC  
**Source**: Claude  
**Session ID**: `fd366052-eb45-4f21-a6ed-39e33ab63aea`

---

### Assistant (02:08 UTC)

I'll explore the spec documents and code in parallel to map out the gaps.

### Assistant (02:09 UTC)

Good. Now I need to read through the spec documents that describe implemented features (Editor, OntologyTree, LanguagePanel, etc.) and compare against the code. Let me focus on the Application/Editor specs since those map to actual UI code.

### Assistant (02:10 UTC)

Understood — spec is law, code catches up. Let me also check the Rust backend for a couple of things.

### Assistant (02:11 UTC)

Now I have the full picture. Here's the gap analysis — **spec features NOT implemented in code**:

---

## Spec vs Code: Unimplemented Features

### Editor-level

1. **`affordance-back`** — Navigate to previously opened sigil (browser-like back with history stack). No history stack exists in code; navigation is always forward-only.

2. **`affordance-export`** (status: idea) — Export sigil as **zip** to share with coding agent. Current export renders to a single `.md` file, not a zip.

3. **`affordance-publish`** — Publish to GitHub. Not implemented.

4. **`affordance-find-references`** — Partially implemented. Code has find-references for the current editor, but the spec implies a broader cross-cutting search surface. *(Borderline — may already satisfy the spec. Worth verifying.)*

5. **`affordance-auto-insert-into-affordance-words-after-so-that`** — Auto-insert affordance words after "so that" in affordance descriptions. Not implemented.

### LanguagePanel

6. **`affordance-insert-image`** (status: idea) — Drag/drop/paste image into language panel, copy to assets dir, insert markdown link. Not implemented.

7. **`affordance-preview-image`** (status: idea) — Render images in preview/split mode. Not implemented.

8. **`affordance-resize-image`** (status: idea) — Drag corner handle to resize image, persist dimensions. Not implemented.

9. **`affordance-auto-fix`** — Auto-create missing symbols typed test-first style. Partially implemented (Alt+Enter creates unresolved references), but the spec implies broader auto-fix.

### OntologyTree

10. **`affordance-move`** — Move sigil (keyboard-based rearrangement). Drag exists but keyboard move (up/down with modifier keys) is not implemented.

11. **`affordance-affordance-indicator`** — Affordance indicator icon next to sigil name in tree. OntologyEditor shows affordance/invariant icons, but TreeView (left panel) does not.

### DesignPartner (entire subsystem)

12. **`affordance-wear-my-sigil`** — Partner self-awareness/persona. Partially implemented via system prompt, not as a discrete feature.

13. **`affordance-get-to-know`** — Build mental model of user. Not implemented.

14. **`affordance-remember` / Memory subsystem** — memorize, recall, recognize observations. Not implemented.

15. **`invariant-keep-a-spellbook` / Spellbook/Spell** — Deterministic task sequences. Not implemented.

16. **`affordance-manipulate-sigils`** — Partner CRUDs sigils via tools. Implemented (tools exist in Rust backend).

17. **Role subsystem** — interruption triggers, one-issue-per-turn, priority order, stop condition. Not implemented as logic — the spec describes sophisticated conversational behavior that would need to be in the system prompt or as structured reasoning.

18. **SigilRefinement / Coverage** — trace-vision, identify-stop, surface-degrees-of-freedom. Not implemented.

19. **SigilRefinement / CoherenceMetric** — All six metrics (name-fit, sibling-separation, affordance-affinity, boundary-sharpness, language-flow, track-over-time). Not implemented.

### Application-level

20. **`affordance-import-external-ontology`** — Import external ontology. Libs folder is mounted, but there's no explicit "import" action or UI.

21. **`affordance-measure-coherence`** — Depends on CoherenceMetric (#19). Not implemented.

22. **`affordance-recognize-when-projectable`** — Know when spec is ready for coding agent. Not implemented.

23. **`affordance-notice-emergent-ontology`** — See which nouns need their own sigil. Not implemented as a feature.

24. **`invariant-example-included`** — Ship this spec itself as the example when user first opens app. Not implemented.

25. **User sigil** (status: idea) — User specifies own invariants/affordances exposed to DesignPartner. Not implemented.

---

**Summary**: ~25 unimplemented spec items. The biggest blocks are the **DesignPartner intelligence** (Role, Memory, Spellbook), **CoherenceMetric** (all 6 measures), **Coverage** tracking, and the **image handling** trio. The smaller gaps are editor conveniences (back navigation, zip export, publish, auto-insert "so that").
