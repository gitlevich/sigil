# Session: synchronous-leaping-crab
**Date**: 2026-04-05 23:47 UTC  
**Source**: Claude  
**Session ID**: `400f95df-f8ad-4259-be53-4fee03f9744a`

---

### Assistant (23:47 UTC)

Let me read the spec and current highlighting implementation.

### Assistant (23:50 UTC)

Good. Now let me read the actual highlighting code to understand the resolution logic.

### Assistant (23:51 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now let me see the decoration logic — the part that actually classifies and decorates references.

### Assistant (23:51 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Let me check the scope resolution functions in sigil-core.

### Assistant (23:51 UTC)

Now I see the issue. `findInvariantInScope` and `findAffordanceInScope` walk up the ancestor tree but they **don't search imported ontologies (Libs)**. They only search within the sigil root tree. Let me verify by checking if there's any Libs handling in these functions.

### Assistant (23:51 UTC)

So `findInvariantInScope` and `findAffordanceInScope` never check Libs. And in `sigilExtensions.ts`, the `findInvariantInScopeLocal` / `findAffordanceInScopeLocal` wrappers only pass `sigilRoot` — they don't include imported ontologies either.

But wait — the user's complaint is broader. Let me re-read: "doesn't highlight affordances, invariants, and imported ontologies, sigils of imported ontologies." Let me check if the problem is actually that the highlighting isn't working at all for standalone `#` and `!` refs, or specifically for lib-scoped ones.

Let me check what the `SigilFolder` type looks like and how `sigilRoot` includes Libs.

### Assistant (23:51 UTC)

*Files: [src/tauri.ts](../../src/tauri.ts)*

Now let me understand the problem better. Let me check how `buildSiblingHighlighter` is called — what gets passed as `siblings` and whether lib affordances/invariants are included.

### Assistant (23:51 UTC)

Let me check how siblings are built — whether lib sigils/affordances/invariants get included.

### Assistant (23:52 UTC)

Let me find where siblings are constructed — the caller that builds the `SiblingInfo[]` array.

### Assistant (23:52 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

Now I need to see how `siblings` is assembled including ontology refs and how it's passed to the editor. Let me search where `flattenOntologyRefs` is called.

### Assistant (23:52 UTC)

OK so the siblings DO include ontology sigils. The `@` sigil refs for libs work (they get `cm-ref-lib`). The question is: do standalone `#affordance` and `!invariant` from imported ontologies resolve?

Looking at `findAffordanceInScopeLocal` (line 148) and `findInvariantInScopeLocal` (line 143), they call `findAffordanceInScope(root, currentPath, name)` and `findInvariantInScope(root, currentPath, name)` from sigil-core. These functions walk the ancestor chain but **never check imported ontologies**. The imported ontologies are a separate tree (`editorCtx.importedOntologies`), not part of `sigilRoot`.

So standalone `#some-affordance` or `!some-invariant` from an imported ontology would show as **unresolved** (wavy red underline).

Similarly, for compound `@LibSigil#affordance` — let me trace through the code at line 731. It calls `resolveRefToContext(sigilRef)` which calls `resolveChainedRef`. For a single segment `@LibSigil`, it calls `findSibling` which finds it in the siblings list as kind "lib". Then `resolveRefToContext` hits the `"contained"/"sibling"` branch which calls `findContextByName` searching `sigilRoot`. But the lib sigil is NOT in `sigilRoot` — it's in `importedOntologies`. So `resolveRefToContext` returns `null`, and `propExists` becomes `false`, marking it as **unresolved**.

That's the bug. Let me fix it.

### Assistant (23:52 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

There are two bugs:

1. **`resolveRefToContext` doesn't handle `"lib"` kind** — lib refs resolve to a SiblingInfo with `kind: "lib"` but the function only checks `"absolute"`, `"contained"`, and `"sibling"`. So `@LibSigil#affordance` can't resolve the target context.

2. **`findAffordanceInScopeLocal`/`findInvariantInScopeLocal` don't search imported ontologies** — standalone `#affordance` and `!invariant` from libs are never found.

Let me fix both.

### Assistant (23:52 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now fix the scope functions to also search imported ontologies for standalone `#` and `!` refs:

### Assistant (23:52 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now add the helper functions. Let me find a good place — right after the existing scope functions:

### Assistant (23:53 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

I need to add the two helper functions. Let me check the imports — I need `findAffordance` which is already imported, and I need `fromDashForm` which is also imported.

### Assistant (23:53 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now let me verify the build compiles.

### Assistant (23:53 UTC)

Clean compile. Here's what was wrong and what I fixed:

**Two bugs in `sigilExtensions.ts`:**

1. **`resolveRefToContext` ignored `"lib"` kind** — When you write `@LibSigil#affordance` or `@LibSigil!invariant`, the sigil resolves as kind `"lib"`, but `resolveRefToContext` only handled `"absolute"`, `"contained"`, and `"sibling"`. It returned `null` for libs, so the affordance/invariant lookup failed and everything showed as unresolved (wavy red). Fixed by walking `importedOntologies` using the resolution's `absolutePath`.

2. **`findAffordanceInScopeLocal`/`findInvariantInScopeLocal` never searched imported ontologies** — Standalone `#affordance` and `!invariant` refs from Libs were invisible. Per the spec (`invariant-imported-ontology-in-scope`), Libs are ambient root scope. Added recursive search through `importedOntologies` as a fallback when the main scope walk finds nothing.

### Assistant (23:53 UTC)

This is a Tauri desktop app — there's no browser dev server to preview. The CLAUDE.md explicitly states the preview workflow doesn't apply here. The type-check passed clean, confirming the fix compiles correctly.

### User (23:54 UTC)

bug:

### Assistant (23:54 UTC)

The screenshot shows `!what-i-care-about` is unresolved even though it's listed right there in the INVARIANTS panel — it's on the **current context itself**. This isn't a lib issue — it's a basic self-resolution failure.

Let me trace the problem. The invariant panel shows `what-i-care-about` as a direct invariant of the current sigil. The standalone `!what-i-care-about` goes through `findInvariantInScopeLocal` → `findInvariantInScope(root, currentPath, name)`.

### Assistant (23:54 UTC)

*Files: [packages/sigil-core/src/refs.ts](../../packages/sigil-core/src/refs.ts)*

The `findInvariantInScope` logic at line 101-132 should find `what-i-care-about` on the current sigil itself (line 109: `findInvariantOn(currentSigil, currentPath, name)`). Let me check the `Sigil` type to make sure invariants are populated.

### Assistant (23:54 UTC)

The invariant name field is the raw name (like `what i care about` with spaces, from the filename `invariant-what-i-care-about.md`). The user writes `!what-i-care-about` (dash form). The `findInvariantOn` function at line 91 does `fromDashForm(name)` which converts dashes to spaces, then checks both. That should work.

Wait — let me check what `findContext` returns. The issue might be that `currentPath` is wrong.

Let me look more carefully at the screenshot. The `@sigil` on line 50 has a dotted purple underline — that's `cm-ref-lib`. So the current context is viewing a sigil where `@sigil` resolves as a **lib** reference. That means the user is editing a sigil that references `@sigil` from an imported ontology.

But `what-i-care-about` is in the INVARIANTS panel of the current view. So it IS on the current sigil. Let me check if maybe `currentContext` doesn't have the invariants populated, or if `currentPath` is pointing somewhere unexpected.

Let me look at how `currentPath` and `currentContext` are set:

### Assistant (23:55 UTC)

Now let me see `scopeInfo`:

### Assistant (23:55 UTC)

Now I see the critical issue. When you're navigating to an imported ontology sigil (e.g., `DesignPartner` from Libs), `scopeInfo` returns:
- `scopeRoot` = `importedOntologies` (the Libs tree)
- `scopePath` = the path within that tree

But look at how `buildSiblingHighlighter` is called at line 316 in `MarkdownEditor.tsx`:

```
buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null, currentPath)
```

And at Workspace.tsx line 381-382:
```
currentContext={currentFolder}
currentPath={scopePath}
```

What's `sigilRoot` here? Let me check:

### Assistant (23:55 UTC)

OK so `sigilRoot` = `scopeRoot`. When navigating into imported ontologies, `scopeRoot` = `importedOntologies`. And `currentPath` = `scopePath` (path within libs).

So `findInvariantInScope(sigilRoot=importedOntologies, currentPath, name)` should walk from the importedOntologies root down to the current ontology sigil and find the invariant. That should work.

Wait — let me recheck. `importedOntologies` is a `SigilFolder` whose children are the individual ontology trees. If current path is e.g. `["SigilEngineering", "DesignPartner"]`, then `findContext(importedOntologies, currentPath)` would navigate `importedOntologies -> SigilEngineering -> DesignPartner`, and the invariant `what-i-care-about` should be on `DesignPartner`.

Let me check `findContext`:

### Assistant (23:55 UTC)

This looks right. Let me think about what else could go wrong. The invariant name stored in the `Sigil` is `what i care about` (spaces), from filename `invariant-what-i-care-about.md`. The user writes `!what-i-care-about` (dashes). `findInvariantOn` does `fromDashForm(name)` which gives `what i care about`, then checks `sigil.invariants.find((s) => s.name === name || s.name === dashed)`. Here `name` is `what-i-care-about` and `dashed` is `what i care about`. The invariant's `.name` is `what i care about`. So `s.name === dashed` should match.

Wait, the variable naming in `findInvariantOn` is confusing:

```js
function findInvariantOn(sigil: Sigil, path: string[], name: string): ... {
  const dashed = fromDashForm(name);   // converts dashes to spaces!
  let inv = sigil.invariants.find((s) => s.name === name || s.name === dashed);
```

So `name` = `what-i-care-about`, `dashed` = `what i care about`. The invariant's `.name` = `what i care about`. Match on `s.name === dashed`. This should work.

Unless the Rust backend is storing the name differently. Let me check:

### Assistant (23:56 UTC)

The Rust backend stores `sig_name` as `what-i-care-about` (the dashed form from the filename, NOT converted to spaces). So the invariant's `.name` in the frontend is `what-i-care-about`.

Now back to `findInvariantOn`:
- `name` = `what-i-care-about` (from user input)
- `dashed = fromDashForm(name)` = `what i care about` (dashes → spaces)
- `sigil.invariants.find((s) => s.name === name || s.name === dashed)`
- Invariant's `.name` = `what-i-care-about`
- `s.name === name` → `"what-i-care-about" === "what-i-care-about"` → **true**

This should match! So the basic resolution logic is correct. Something else must be wrong.

Let me look more carefully at the screenshot. The `@sigil` on line 50 has a dotted purple underline (lib). The `@SigilEngineering` on line 48 also has a dotted purple underline. The `@user` on line 46 has a dashed orange (sibling). So the user is editing a sigil where `@sigil` and `@SigilEngineering` are imported ontology terms.

This means the user is likely browsing INTO an imported ontology sigil (like `DesignPartner`). In that case, `scopeRoot = importedOntologies`, and the invariants should be on the current context.

Hmm, but wait. Could the issue be that `setGlobalImportedOntologies` is called separately and when browsing inside an imported ontology, the `sigilRoot` passed to `buildSiblingHighlighter` is already the `importedOntologies` tree? Let me check what `setGlobalImportedOntologies` is set to:

### Assistant (23:56 UTC)

Now look at `buildLexicalScope` which is called at line 324:

### Assistant (23:56 UTC)

*Files: [packages/sigil-core/src/refs.ts](../../packages/sigil-core/src/refs.ts)*

I see it now! `buildLexicalScope` at line 210 looks for ontologies under `root.children.find(c => c.name === "Libs")`. But when browsing an imported ontology, `root` is `importedOntologies` (which IS the Libs tree), not the main sigil root. The Libs node won't be found as a child of itself.

But that's about sigil refs, not invariant resolution. The invariant resolution at lines 237-253 walks the current sigil and ancestors. For a sigil inside imported ontologies, this should still work because `root` = `importedOntologies` and `currentPath` walks within it correctly.

Let me add some debugging. Actually, let me think about this differently. Let me re-examine the screenshot more carefully.

The user is viewing a sigil that has:
- `@sigil` → lib (purple dotted) 
- `@SigilEngineering` → lib (purple dotted)
- `@user` → sibling (orange dashed)
- `!what-i-care-about` → unresolved (red wavy)

And the INVARIANTS panel shows `always-tell-the-truth`, `full-access`, `keep-a-spellbook`, `what-i-care-about`.

Wait — `@user` is a **sibling**, not a lib. So this sigil is NOT inside imported ontologies — it's in the main tree. But `@sigil` and `@SigilEngineering` resolve as libs. That makes sense — those are imported ontology terms available in ambient scope.

So `sigilRoot` = the main root, `currentPath` = path in the main tree, and `currentContext` = the current sigil (which has those 4 invariants).

`findInvariantInScope(sigilRoot, currentPath, "what-i-care-about")` should find it on the current sigil. Let me re-examine `findInvariantOn` very carefully:

```js
function findInvariantOn(sigil: Sigil, path: string[], name: string) {
  const dashed = fromDashForm(name);  // "what i care about"
  let inv = sigil.invariants.find((s) => s.name === name || s.name === dashed);
```

The invariant's `.name` from Rust is `what-i-care-about` (the dashed filename form). `name` param is also `what-i-care-about`. So `s.name === name` should be `true`.

Unless the name has some prefix issue. Let me check back in the highlighting code at line 743-746:

```js
} else if (matchText.startsWith("!")) {
  const invariantName = matchText.slice(1);
  const invariantExists = findInvariantInScopeLocal(invariantName) !== null;
```

So `invariantName` = `what-i-care-about` (sliced after `!`). That's correct.

I'm stuck on why this doesn't work from the code alone. Let me check if there's a fenced code block issue — but the screenshot shows plain markdown text, not code.

Actually, let me look at line 714 more carefully:

```js
if (isInCodeSpan(matchLine.text, abs - matchLine.from)) continue;
```

Could `isInCodeSpan` be giving a false positive? The line text is `In this @sigil, here is !what-i-care-about`. No backticks. So `isInCodeSpan` returns false. Fine.

Let me check if maybe the `RangeSetBuilder` requires sorted insertions and there's an ordering issue. The builder iterates through visible ranges and processes matches in order within each range. Matches from `allRefsPattern` within a single visible range should be in order. But what about across visible ranges? Each `{ from, to }` range should be non-overlapping and ordered. So the builder should get decorations in order.

Wait — could the issue be simpler? Let me check if the `!` at the beginning of a line is being treated as a markdown heading or something by CodeMirror's base markdown parser, and the match is getting eaten.

Actually, I just realized something. Let me look at the regex again:

```
/@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g
```

The `!` branch: `![a-zA-Z_][\w-]*` — this matches `!what-i-care-about`. But could the `@` branch's optional `(?:[#!][a-zA-Z_][\w-]*)?` be consuming the `!` reference as part of a preceding `@sigil`? No, because the `@` branch only matches if it starts with `@`.

OK wait — I just re-read the line: `In this @sigil, here is !what-i-care-about`. The regex is global. First match: `@sigil` (no `#!` suffix since comma follows). Second match: `!what-i-care-about`. Both should work.

Let me just check if perhaps the issue is that `editorCtx.sigilRoot` or `editorCtx.currentPath` is null/wrong when the decorator runs. Let me check if maybe there's a timing issue — the siblings/root are set via `buildSiblingHighlighter` but maybe it's reconfigured with stale data.

Actually, you know what, let me just build and test. But first, let me check one more thing — could the issue be that `findInvariantInScope` gets `currentPath` that doesn't correctly lead to the current sigil?

Let me add a quick console.log to diagnose, build, test, then remove it. Actually, the user showed me a screenshot — the bug exists in the current running app. My code changes haven't been built yet. Let me see if my changes from the previous fix would help or not.

My changes were to `findInvariantInScopeLocal` — I added fallback to search imported ontologies. But the base case (searching within `sigilRoot`) should already find `what-i-care-about` on the current sigil. Unless something else is broken.

Let me check: could the issue be that the `.invariants` array on the SigilFolder is empty when passed through `buildSiblingHighlighter`, even though the panel shows them? The panel and the editor use different data sources — the panel reads directly from state, while the editor uses the `editorCtx` global.

Actually, let me check how `currentContext` is set. In `buildSiblingHighlighter`:
```js
editorCtx.currentContext = currentCtx;
```

And `currentCtx` comes from `currentFolder` in Workspace, which is resolved via `resolveCurrentFolder(ws)`:

### Assistant (23:57 UTC)

OK. Now look at where the editor actually gets `sigilRoot` and `currentContext`:

At Workspace.tsx line 320:
```js
const { scopeRoot, scopePath } = scopeInfo(ws);
```

And then at line 380:
```
sigilRoot={scopeRoot}
currentContext={currentFolder}
currentPath={scopePath}
```

Where `currentFolder` is from line 238:
```js
const currentFolder = resolveCurrentFolder(ws);
```

So `currentContext` = the actual current sigil folder (correct), `sigilRoot` = `scopeRoot` (the root for scoping), and `currentPath` = `scopePath` (path within that root).

For a non-imported path, `scopeRoot` = `spec.root`, `scopePath` = `currentPath`. `currentFolder` = `findContext(spec.root, currentPath)`. The invariants should be on `currentFolder` which equals `findContext(spec.root, scopePath)` = the same thing.

In `findInvariantInScope`:
```js
const currentSigil = findContext(root, currentPath);
```
where `root` = `scopeRoot` = `spec.root`, `currentPath` = `scopePath` = `ws.currentPath`. So `currentSigil` = same as `currentFolder`. And `currentSigil.invariants` should include `what-i-care-about`.

I'm going in circles. Let me just look at the actual sigil files to see what the invariant names are:

### Assistant (23:57 UTC)

The invariant file doesn't exist in this repo. The user is editing a different sigil spec loaded into the app. The code logic seems correct for the non-imported case. Let me look at this from a different angle — maybe the issue is with the `collectAncestorProperties` function or the `buildLexicalScope` in `Workspace.tsx` line 324.

Wait. Let me re-read line 320-343 in Workspace more carefully:

### Assistant (23:57 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

I see `buildLexicalScope` on line 324 — but this is a different function from the one in `sigil-core`. Let me check:

### Assistant (23:57 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

This local `buildLexicalScope` only builds **sigil** refs (`@` refs). It doesn't build `#` or `!` refs. That's fine because the highlighting of `#` and `!` goes through `findAffordanceInScopeLocal`/`findInvariantInScopeLocal`, not through the siblings list.

OK, I've been going in circles. Let me add a temporary diagnostic log, build the app, and see what's happening at runtime.

Actually wait — let me look at this from a completely different angle. Let me check if maybe the issue is that the `!` at the start of a markdown-parsed paragraph gets treated as an image `![]()` syntax by CodeMirror's markdown parser, causing it to be wrapped in a node that prevents decoration.

But the decoration code doesn't use the markdown syntax tree — it does raw regex matching on the text. So markdown parsing shouldn't matter.

Let me look at one more thing — the `RangeSetBuilder`. It requires decorations added in **strictly increasing order by position**. Let me re-examine the build loop:

```js
for (const { from, to } of view.visibleRanges) {
  const text = view.state.doc.sliceString(from, to);
  let match;
  allRefsPattern.lastIndex = 0;
  while ((match = allRefsPattern.exec(text)) !== null) {
    const matchText = match[0];
    const abs = from + match.index;
    ...
    builder.add(abs, abs + matchText.length, mark);
  }
}
```

Within a single visible range, `match.index` increases monotonically, so `abs` is always increasing. Across visible ranges, `from` increases. So the builder gets decorations in order. Should be fine.

Let me try something: maybe the issue is that the `allRefsPattern` regex's `!` branch is too greedy and picks up markdown image syntax `![alt](url)` incorrectly. In markdown, `!` followed by `[` is image syntax. But the regex requires `![a-zA-Z_]` — so `![` wouldn't match (since `[` is not `[a-zA-Z_]`).

Hmm, but what if the match is consumed by the `@` branch? Look: `@sigil, here is !what-i-care-about`. The regex `allRefsPattern` is global. First match: `@sigil` at some index. Then continuing, next match should be `!what-i-care-about`. But could there be an issue with `lastIndex` being wrong because we're using `exec` on a sliced string?

Actually, `allRefsPattern.lastIndex = 0` is set at the top of each visible range. And the text is `view.state.doc.sliceString(from, to)` which is a fresh string. So `lastIndex` should work fine.

I'm really stuck. Let me just add a debug log and let the user test.

Actually — wait. Let me look at one more thing. The `allRefsPattern` uses `\w` which includes digits and underscore. `[\w-]` also includes hyphens. So `what-i-care-about` matches `[\w-]*`. The full `![a-zA-Z_][\w-]*` should match `!what-i-care-about` where `w` is the first char after `!`. That's correct.

Let me look at the **specific** place in code where `!` refs are handled in the decorator:

```js
} else if (matchText.startsWith("!")) {
  const invariantName = matchText.slice(1);
  const invariantExists = findInvariantInScopeLocal(invariantName) !== null;
  builder.add(abs, abs + matchText.length, invariantExists ? invariantMark : unresolvedMark);
}
```

`findInvariantInScopeLocal("what-i-care-about")` calls `findInvariantInScope(editorCtx.sigilRoot, editorCtx.currentPath, "what-i-care-about")`.

Now: `editorCtx.sigilRoot` and `editorCtx.currentPath` — are these set correctly? They're set in `buildSiblingHighlighter` which runs on every reconfigure. But the decorator's `build()` method runs separately when the view updates. If the decorator runs BEFORE `buildSiblingHighlighter` sets the context, the values could be wrong.

But `buildSiblingHighlighter` is called during `siblingCompartment.of(buildSiblingHighlighter(...))` which creates the extension. The ViewPlugin constructor runs when the extension is installed, and `buildSiblingHighlighter` mutates `editorCtx` synchronously before returning the extensions. So the context should be set before the ViewPlugin's `build()` first runs.

OK, I think I need to actually test this. Let me build the app.

### Assistant (23:58 UTC)

Good, frontend builds. Now let me build the Tauri app to test:

### Assistant (23:58 UTC)

Let me run the app and check if the highlighting works. But first, let me add a temporary console.log to diagnose the actual issue:

### Assistant (23:58 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Let me add a temporary debug log:

### Assistant (23:58 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Also add one for affordances:

### Assistant (23:58 UTC)

*Files: [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts)*

Now let me run the app so the user can test:

### Assistant (23:58 UTC)

The app is starting. Can you navigate to the sigil where you saw the bug (the one with `!what-i-care-about`) and open the browser devtools console? The debug logs will show exactly why the invariant is resolving as unresolved — it'll print the root name, current path, and the invariants list on the current context. That will tell us the root cause.

### Assistant (23:59 UTC)

The app is launching via `npx tauri dev` in the background. Navigate to the sigil with `!what-i-care-about` and check the browser devtools console (right-click → Inspect → Console) for `[sigil-debug]` messages. That will show us why the invariant isn't resolving.
