# Session: parsed-percolating-oasis
**Date**: 2026-04-04 05:06 UTC  
**Source**: Claude  
**Session ID**: `d5930249-75a9-434e-85b2-56d5339a8262`

---

### Assistant (05:06 UTC)

Good idea. Let me understand the current site setup before planning.

### Assistant (05:07 UTC)

Let me read the spec.

### Assistant (05:07 UTC)

*Files: [site/src/data/sigil-spec.json](../../site/src/data/sigil-spec.json)*

I've read enough of the spec to understand the structure. Let me now read the DesignPartner > Chat and Memory sections since they're most relevant to what you're proposing.

### Assistant (05:08 UTC)

OK. So the spec has DesignPartner with Chat, Persona, Craft, Prompt, SigilRefinement as children. The web version you're proposing is a stripped-down DesignPartner experience:

**What maps to the spec:**
- @Chat exists — but on the web, it's transient (no #persist)
- @DesignPartner inhabits the sigil (!full-context) — on the web, it sees the published spec read-only
- BYOK means no backend — the browser calls Claude directly

**What's different from the desktop spec:**
- No #persist — conversation dies when you close the tab
- No #manipulate-sigils, #manipulate-affordances, #manipulate-invariants — the spec is read-only on the web
- No @Memory, no @Spellbook
- No #branch, #interrupt (at least initially)

**So the question is:** do you want to spec this as a new sigil (e.g., a `WebChat` or `GuestPartner` child under DesignPartner or Application), or as a constrained projection of the existing @Chat sigil? 

The spec language would be something like: "A visitor reads the spec and converses with a design partner that inhabits it read-only. The partner can #navigate, explain, and answer questions about the spec — but cannot modify it. The conversation is transient. The visitor brings their own API key."

How do you want to approach this?

### Assistant (05:10 UTC)

Got it. The site already exists as a parallel surface — viewer, landing page, contact. Let me read the actual implementation to understand what's already projected.

### Assistant (05:10 UTC)

*Files: [site/src/App.tsx](../../site/src/App.tsx), [site/src/landingContent.ts](../../site/src/landingContent.ts)*

Clear picture now. The site has:

1. **Landing page** — hero, story, pull quote, implementation section, links grid (spec viewer, GitHub, releases), contact form, footer
2. **Spec Viewer** — at `#/viewer`, with TreeView, MarkdownPreview, PropertyBar, SubContextBar, Atlas, Breadcrumb, ThemeToggle, MobileViewer

So you want a new top-level sigil `sigilengineering.com` that retroactively specs what the website already is, and then the chat feature gets added there as a new affordance. The website is a read-only public surface for the spec — distinct from @Application which is the editor.

Ready to talk structure. Where do you want to put it in the tree? I'd suggest as a sibling of `Application` under the root `sigil-editor`, since the website is a parallel projection of the same spec — not a child of the editor.
