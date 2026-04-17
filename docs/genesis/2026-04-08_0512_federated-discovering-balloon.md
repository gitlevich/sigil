# Session: federated-discovering-balloon
**Date**: 2026-04-08 05:12 UTC  
**Source**: Claude  
**Session ID**: `a88ba062-0c5a-4608-96dd-f8847e549626`

---

### Assistant (05:13 UTC)

Now let me read the key spec files related to naming, lexical scope, and the Sigil definition.

### Assistant (05:14 UTC)

*Files: [specification.sigil/Libs/AttentionLanguage/Sigil/language.md](../../specification.sigil/Libs/AttentionLanguage/Sigil/language.md), [specification.sigil/Libs/AttentionLanguage/Sigil/affordance-name.md](../../specification.sigil/Libs/AttentionLanguage/Sigil/affordance-name.md), [specification.sigil/Application/User/Workspace/invariant-lexical-scoping.md](../../specification.sigil/Application/User/Workspace/invariant-lexical-scoping.md), [specification.sigil/Application/DesignPartner/Love/Language/Unambiguous/language.md](../../specification.sigil/Application/DesignPartner/Love/Language/Unambiguous/language.md), [specification.sigil/Application/DesignPartner/Love/Language/Unambiguous/invariant-every-word-is-scoped.md](../../specification.sigil/Application/DesignPartner/Love/Language/Unambiguous/invariant-every-word-is-scoped.md), [specification.sigil/Application/DesignPartner/Love/Language/LexicalScope/language.md](../../specification.sigil/Application/DesignPartner/Love/Language/LexicalScope/language.md), [specification.sigil/Application/SigilFolder/language.md](../../specification.sigil/Application/SigilFolder/language.md), [specification.sigil/Application/User/Workspace/Narrating/Language/affordance-autocomplete-references.md](../../specification.sigil/Application/User/Workspace/Narrating/Language/affordance-autocomplete-references.md), [specification.sigil/Application/User/Workspace/Narrating/Language/affordance-reference-syntax-highlighting.md](../../specification.sigil/Application/User/Workspace/Narrating/Language/affordance-reference-syntax-highlighting.md), [specification.sigil/Application/User/Workspace/affordance-find-references.md](../../specification.sigil/Application/User/Workspace/affordance-find-references.md), [specification.sigil/Application/User/Workspace/invariant-imported-ontology-in-scope.md](../../specification.sigil/Application/User/Workspace/invariant-imported-ontology-in-scope.md)*

Good. I've internalized the spec. Now let me think about where aliases and the sigil resolver belong.

---

Two things are on the table:

1. **Sigil aliases** — a sigil can have alternative names
2. **Sigil resolver** — the "parser" is really a resolver: given a reference, walk the sigil tree using lexical scope precedence to find what it points to

Here's where I see them landing:

### Aliases → `Libs/AttentionLanguage/Sigil/affordance-alias.md`

An alias is an affordance of a Sigil itself — it's something a sigil *can do*: be known by another name. It sits alongside `affordance-name.md`. The name is its primary handle; aliases are additional handles that resolve to the same sigil. This belongs in the AttentionLanguage definition of Sigil because aliasing is constitutive of what a sigil *is*, not specific to this application's UI.

At the filesystem level, this probably means a metadata mechanism in the sigil folder (e.g., in `language.md` frontmatter, or a dedicated file). That implementation detail would be specified as an affordance on `SigilFolder` — something like how aliases are stored. But the *concept* lives at `Sigil`.

### Resolver → `Application/User/Workspace/invariant-lexical-scoping.md` (extend) + new affordance

The resolver is the *mechanism* that enforces the lexical scoping invariant. The invariant already defines the precedence rules. What's missing is the affordance that makes resolution an explicit capability:

- **`Application/User/Workspace/affordance-resolve-reference.md`** — the workspace can resolve any `@Sigil`, `#affordance`, or `!invariant` reference to its target by walking lexical scope. This is the single operation that autocomplete, syntax highlighting, find-references, and the DesignPartner's read-sigil all depend on.

This sits at Workspace because resolution is scope-dependent — you resolve *from* a position in the tree. The Workspace knows where you are.

The "special case parser" then dissolves: it's just the resolver walking scope. No parser — just resolution against the tree. The `@`, `#`, `!` sigils in text are handles that the resolver looks up.

---

**Summary:**

| What | Where | Why |
|------|-------|-----|
| Alias (concept) | `Libs/AttentionLanguage/Sigil/affordance-alias.md` | Constitutive of Sigil — not app-specific |
| Alias (storage) | `Application/SigilFolder/` — e.g. frontmatter or dedicated file | Filesystem representation detail |
| Resolver | `Application/User/Workspace/affordance-resolve-reference.md` | Scope-dependent operation, enforces `invariant-lexical-scoping` |

Does this placement feel right?

### Assistant (05:19 UTC)

Right. `#affordances` and `!invariants` are verbatim string matches — no indirection needed. Only `@Sigil` references need aliasing, because a sigil is a concept that might be known by more than one name.

So alias isn't its own affordance file — it extends `affordance-name.md`, which already says "the handle by which I recognize this Sigil." Aliases are just additional such handles. One primary name (the folder name), zero or more aliases that resolve to the same sigil.

That keeps it at `Libs/AttentionLanguage/Sigil/affordance-name.md` — no new file, just a richer definition of what "name" means for a sigil.

The resolver then only needs alias lookup for `@` references. `#` and `!` are exact matches against the current sigil's surface.

### Assistant (05:19 UTC)

Yes. That's clean. A sigil is the only thing with identity — affordances and invariants are parts of its surface, not independent entities. They don't have identity, so they can't have aliases. They're found by their verbatim text within the sigil that owns them.

So the resolver has two modes:

- `@Name` — resolve a sigil by name or alias, walking lexical scope with precedence rules
- `#text` / `!text` — exact string match against the resolved sigil's surface

Aliases live in `affordance-name.md` as part of what it means for a sigil to have a name. The resolver lives at Workspace as the mechanism that enforces lexical scoping.

### Assistant (05:20 UTC)

*Files: [specification.sigil/Libs/AttentionLanguage/Sigil/affordance-affordance.md](../../specification.sigil/Libs/AttentionLanguage/Sigil/affordance-affordance.md), [specification.sigil/Libs/AttentionLanguage/Sigil/invariant-invariants-enforced.md](../../specification.sigil/Libs/AttentionLanguage/Sigil/invariant-invariants-enforced.md), [specification.sigil/Application/SigilFolder/AffordanceFile/language.md](../../specification.sigil/Application/SigilFolder/AffordanceFile/language.md), [specification.sigil/Application/SigilFolder/InvariantFile/language.md](../../specification.sigil/Application/SigilFolder/InvariantFile/language.md)*

Now let me check how references are actually used in the spec text — the `@`, `#`, `!` syntax:

### Assistant (05:21 UTC)

*Files: [specification.sigil/Application/User/Workspace/Narrating/Language/affordance-reference-tooltips.md](../../specification.sigil/Application/User/Workspace/Narrating/Language/affordance-reference-tooltips.md), [specification.sigil/Application/affordance-name-affordances.md](../../specification.sigil/Application/affordance-name-affordances.md), [specification.sigil/Application/User/Workspace/Narrating/Language/affordance-auto-fix.md](../../specification.sigil/Application/User/Workspace/Narrating/Language/affordance-auto-fix.md)*

I see `@Sigil#names` in the lexical scoping invariant — the `#` syntax is used to reference an affordance *of a specific sigil*. Let me check what reference syntaxes exist:

### Assistant (05:21 UTC)

Here's what the spec actually uses:

**Three reference forms exist in practice:**

1. **`@Sigil`** — resolve a sigil by name in lexical scope
2. **`@Sigil#affordance`** — qualified: resolve sigil, then find affordance on its surface (e.g. `@Sigil#names`, `@Workspace#navigate`, `@Coherence#sense`)
3. **`@Sigil@Sigil`** — path: resolve through a sigil to reach a child sigil (e.g. `@EcologicalPsychology@Affordance`, `@McGilchrist@LeftHemisphere`, `@DifferentialGeometry@timelike`)

Also bare `#affordance` and `!invariant` appear within a sigil's own text, referring to its own surface.

So the resolver is **not** verbatim-only for affordances. It needs to:
- Resolve `@Name` (sigil by name or alias, lexical scope precedence)
- Resolve `@A@B` (path through sigils — A then child B)
- Resolve `@A#b` (sigil A, then affordance `b` on its surface)
- Resolve bare `#b` / `!b` (current sigil's own surface — these are verbatim)

The `#` and `!` parts are always verbatim matches against a resolved sigil's surface. But they're not always bare — they can be qualified with a sigil path first. The resolver's job is: resolve the sigil path, then match the member literally.

### Assistant (05:23 UTC)

Let me explore the current implementation to understand how references are parsed and resolved today.

### Assistant (05:24 UTC)

The explorer says everything is "fully supported" but you're telling me `@Sigil@Child` paths show gray and aren't clickable. Let me read the actual resolution code to see what's really happening.

### Assistant (05:24 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now let me check the `walkTree` function and the `findSibling` logic more closely — that's where the resolution actually happens for chained refs. I also need to see what `resolveRefName` does and understand why paths might resolve as "external" (gray).

### Assistant (05:25 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now I see the issue. Look at `resolveChainedRef` lines 259-261: when the first segment isn't the root and isn't in imported ontologies, it falls through to `findSibling`. But for a chained ref like `@Sibling@Child`, `findSibling` only finds the first segment — there's no code to walk *into* a sibling's children. It returns `"external"` with the message "sigil boundary — cannot reach into @Name".

Let me verify by looking at how siblings are built — what's actually in the siblings list.

### Assistant (05:25 UTC)

*Files: [src/components/Workspace/lexicalScope.ts](../../src/components/Workspace/lexicalScope.ts)*

Now I understand the full picture. Let me look at `resolveChainedRef` once more closely for the multi-segment case where the first segment is a **sibling** (not the root, not a lib):

Lines 259-261: when `@A@B` and A is a sibling but not the root and not a lib, it falls through to:
```typescript
const firstInfo = findSibling(segments[0]);
return { kind: "external", path: segments, summary: ... "cannot reach into @..." };
```

That's the bug. The code treats reaching into a sibling's children as "external" (boundary violation). But according to the lexical scoping spec, siblings are visible one level deep — you see their name, affordances, invariants, but NOT their children. So `@Sibling@Child` is actually **out of scope** per the spec.

But `@EcologicalPsychology@Affordance` works because EcologicalPsychology is a **lib** (imported ontology), and libs have special handling. Let me re-read the scoping invariant.

### Assistant (05:25 UTC)

*Files: [specification.sigil/Application/User/Workspace/invariant-lexical-scoping.md](../../specification.sigil/Application/User/Workspace/invariant-lexical-scoping.md)*

OK so the spec says:
- siblings: their names, affordances, invariants (but not their children)
- ancestors: each ancestor and its children one level deep

So `@Sibling@Child` **is** out of scope per the current spec. But `@Lib@Child` works because libs are root scope.

The question is: what about the `@EcologicalPsychology@Affordance` pattern used heavily in the spec? That works because EcologicalPsychology is a lib. And `@McGilchrist@LeftHemisphere` — also a lib.

What about `@Workspace#navigate`? Workspace is an ancestor's child — reachable in scope. The `#` form works because it resolves Workspace first, then finds the affordance on it. That's fine.

So actually: the "gray and not clickable" problem — which references specifically are failing? Let me check if the user is writing `@Sigil@Child` paths where the first segment is a sibling (not root, not lib). Or is there another issue?

Let me check `@Spellbook@Spell` — that's used in the spec:

### Assistant (05:25 UTC)

That reference is in `DesignPartner/invariant-keep-a-spellbook.md`. From DesignPartner's perspective, Spellbook is a child. So `@Spellbook@Spell` = child path. In `resolveChainedRef`, the first segment "Spellbook" — is it the root? No. Is it in imported ontologies? No. Falls through to `findSibling`. Gets kind "external". **That's the bug.**

The code can walk paths starting from root or libs, but NOT from siblings/children. Any `@A@B` where A is a sibling or child resolves as "external" (gray).

Now let me check navigation (click) handling:

### Assistant (05:25 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Good. Now I have the full picture. Let me write the plan.
