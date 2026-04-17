# Session: lucky-sniffing-meteor
**Date**: 2026-04-15 16:59 UTC  
**Source**: Claude  
**Session ID**: `ae7576f5-2f07-4649-a38e-295dfe1fcc73`

---

### Assistant (16:59 UTC)

This is critical — let me trace the file watcher and auto-save interaction immediately.

### Assistant (16:59 UTC)

*Files: [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts), [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts)*

Now I need to see how the file watcher's `reload` callback interacts with the editor content. Let me find where these hooks are used together.

### Assistant (16:59 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now I see the critical path. `reload()` is called on every FS change event, and it reloads the spec. Let me see what `reload` does to the editor content.

### Assistant (16:59 UTC)

*Files: [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx)*

Now I need to see how `UPDATE_SPEC` affects the editor content. Let me check the reducer and how the editor responds to spec changes.

### Assistant (17:00 UTC)

*Files: [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx)*

Now let me find where the editor gets its initial content and how it reacts when the spec updates.

### Assistant (17:00 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

Now let me look at SigilEditor to see how it handles the `content` prop — specifically whether it replaces the CodeMirror doc when the prop changes.

### Assistant (17:00 UTC)

*Files: [src/components/Workspace/SigilEditor.tsx](../../src/components/Workspace/SigilEditor.tsx), [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Found it. The race condition is on lines 576–604 of [LanguageEditor.tsx](src/components/Workspace/LanguageEditor.tsx). Here's what happens:

1. User types → CodeMirror fires `onChangeRef.current(text)` → `handleContentChange` in Workspace schedules a **300ms debounced** `UPDATE_SPEC` dispatch (line 230)
2. Auto-save writes the file to disk after **500ms** (the `useAutoSave` delay)
3. The file write triggers an `FsChangeEvent` from Tauri's watcher
4. The watcher debounces for **1000ms**, then calls `reload()` which does `api.readSigil()` → `UPDATE_SPEC`
5. `UPDATE_SPEC` replaces `ws.spec`, which changes `currentFolder.language`, which changes the `content` prop
6. In the `useEffect` on line 576: `localEditRef.current` is `true` and `navigated` is `false`, so it returns early — **this is the intended guard**

But the guard fails when the 300ms debounce in `handleContentChange` hasn't fired yet but the file watcher's reload has. The sequence:

- User types "abc" → `onChangeRef.current("abc")` → `localEditRef.current = true`, debounce timer set for 300ms
- Auto-save writes "abc" at 500ms → triggers FS event
- At ~800ms, debounce fires, dispatches `UPDATE_SPEC` with "abc" in the tree → `localEditRef.current` still `true` ✓
- User types "abcdef" → `localEditRef.current = true` again, new 300ms debounce queued
- At ~1500ms, file watcher fires `reload()` → reads disk (which has "abc" from the earlier save, not "abcdef") → dispatches `UPDATE_SPEC` with "abc"
- Now `content` prop changes to "abc". The effect runs: `localEditRef.current` is `true`, `navigated` is `false` → **it skips** ✓

Wait — that guards correctly. Let me re-examine. The real danger is when `localEditRef.current` gets reset to `false`. That happens on line 587 when `currentDoc === content`. If the debounced `UPDATE_SPEC` from `handleContentChange` happens to make `content` match `currentDoc` exactly, the flag resets. Then if the watcher's `reload()` arrives with stale disk content *after* the user typed more...

Actually the timing is tighter than that. Let me look at the specific sequence more carefully.

The `localEditRef` gets set to `false` on line 587-589 when `currentDoc === content`. This happens when the debounced `handleContentChange` at 300ms updates the spec tree to match what CodeMirror has. At that instant, `localEditRef` resets. Then:

1. User types more characters (localEditRef → true again, new debounce)
2. The file watcher reload arrives with old disk content → `UPDATE_SPEC` with old content
3. `content` prop now has old content, `currentDoc` has new content
4. Effect runs: `localEditRef.current` is `true` (user typed after the reset) → **skips** ✓

Hmm, that still guards. Let me think about when `localEditRef` could be `false` while the user has unsaved edits...

The critical window: The 300ms `handleContentChange` debounce fires and updates the spec. This causes a re-render where `content === currentDoc`, so `localEditRef` resets to `false`. The user hasn't typed anything new yet. But then the watcher reload arrives with stale disk content (from a *previous* save). Now `content !== currentDoc` and `localEditRef.current` is `false` — **the editor gets overwritten with stale content**.

The sequence:
1. User types "A" → auto-save pending, debounce pending
2. 300ms: debounce fires, `UPDATE_SPEC` with "A" in tree → `content === currentDoc` → `localEditRef = false`
3. 500ms: auto-save writes "A" to disk → triggers FS event
4. User types "AB" → `localEditRef = true`, new debounce at 300ms
5. 1500ms: file watcher fires, reads disk ("A") → `UPDATE_SPEC` with "A"
6. `content = "A"`, `currentDoc = "AB"`, `localEditRef = true` → **skipped** ✓

But what if step 4 happens *after* step 5? User pauses typing:
1. User types "A" → auto-save pending
2. 300ms: debounce fires, spec updated with "A" → `localEditRef = false`
3. 500ms: auto-save writes "A" → FS event
4. 1500ms: watcher fires, reads "A", dispatches `UPDATE_SPEC` with "A" → `content === currentDoc` → `localEditRef = false` (already was)
5. User types "AB" → `localEditRef = true`

That's fine. But what about this:
1. User types "A" 
2. 300ms: handleContentChange debounce fires → spec has "A" → localEditRef=false
3. 500ms: auto-save writes "A"
4. User types "AB" → localEditRef=true, new 300ms debounce
5. 800ms: handleContentChange debounce fires → spec has "AB" → content="AB", currentDoc="AB" → localEditRef=false
6. 1000ms: auto-save writes "AB" (new save triggered by step 4)
7. 1500ms: first watcher fires (from step 3's write), reads disk. Disk has "AB" (step 6 already wrote). → content="AB" = currentDoc → no overwrite ✓

The race window is when the watcher fires between steps 5 and 6, and disk still has "A":
1-5 same as above
6. **1200ms: watcher fires (from step 3's write), reads disk — disk has "A"** → `UPDATE_SPEC` with "A" → `content="A"`, `currentDoc="AB"`, `localEditRef=false` → **OVERWRITES EDITOR WITH "A"** 

There it is. The `localEditRef` guard fails because `handleContentChange`'s 300ms debounce resets it to `false` *before* the file watcher's stale reload arrives. The fix: instead of a boolean flag, compare the actual CodeMirror doc against the incoming content. If CodeMirror's doc is *ahead* of what's being pushed from the prop, never overwrite.

### Assistant (17:01 UTC)

*Files: [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Now let me verify the logic is sound by also checking that `lastLocalContentRef` is properly maintained. Looking back at the code: line 322 sets `lastLocalContentRef.current = text` every time the user types. The old guard on line 593 (`if (localEditRef.current && !navigated)`) failed in this window:

**The race:** User types → 300ms debounce fires `handleContentChange` → React re-renders → `content === currentDoc` → `localEditRef = false`. Now the watcher reload arrives with stale disk content. `localEditRef` is `false`, so the old code fell through and overwrote the editor.

**The fix adds a second guard:** even if `localEditRef` was reset to `false`, we check `lastLocalContentRef.current !== null && currentDoc === lastLocalContentRef.current`. This catches the case where CodeMirror still holds what the user typed but the incoming `content` is stale from disk. `lastLocalContentRef` only gets cleared when `currentDoc === content` (the prop caught up) or on navigation — never by the debounce echo alone.

This is a Tauri app, no browser preview applies. Let me run the build to verify no type errors.

### Assistant (17:01 UTC)

That error is pre-existing (in `narration.ts`, visible in the git status as already modified). My change introduces no new errors.

The race condition: when you type, auto-save writes to disk, which triggers the file watcher. The watcher reads the file back — but by then you've typed more characters. The old guard (`localEditRef`) got reset to `false` by a debounce echo between your keystrokes and the watcher's arrival, so the stale disk content overwrote your editor.

The fix adds a second check: even after the boolean flag resets, we compare CodeMirror's current doc against `lastLocalContentRef` — the last thing you actually typed. If they match, the incoming prop is stale and we refuse to overwrite. The ref only clears when the prop genuinely catches up or you navigate away.

### Assistant (17:03 UTC)

You're right. Let me trace the whole cycle and find where it went wrong structurally.

### Assistant (17:03 UTC)

*Files: [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Let me look at the full picture — the content flows through three separate paths and they're all fighting each other.

### Assistant (17:03 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx), [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

OK. Now I see the full picture. Here's the decoherence.

There are **three independent representations** of the document content, updated by **three independent timers**, with **no single source of truth**:

1. **CodeMirror's doc** — the actual editor state. Updated instantly on keystrokes.
2. **React state** (`ws.spec.root...language`) — the prop `content`. Updated by a **300ms debounce** in `handleContentChange`.
3. **Disk** (`language.md`) — updated by a **500ms debounce** in `useAutoSave`.

And then a **fourth actor**: the file watcher (1000ms debounce) reads disk and calls `reload()`, which calls `api.readSigil()` and replaces the *entire spec* via `UPDATE_SPEC`. This overwrites representation #2 with whatever disk had, which may be behind both #1 and the in-flight #2.

The decoherence: `handleContentChange` does a local tree update (patches one node in the spec), but the watcher's `reload()` replaces the *entire* spec from disk. These two `UPDATE_SPEC` dispatches race. The watcher doesn't know that a local edit patched the tree — it just replaces everything. Then LanguageEditor sees the stale `content` prop and has to decide whether to trust it. That's why we need `localEditRef`, `lastLocalContentRef`, base-content tracking, conflict detection — all compensating for the fundamental problem.

The root cause: **the file watcher reloads content for the file being edited**. It shouldn't. The watcher exists to detect *structural* changes (new sigils created, files renamed, external edits to *other* files). When the file being edited changes on disk due to our own auto-save, the watcher should not reload that file's content into the spec.

The fix is simple: the watcher's reload should preserve the local tree node for the currently-edited path instead of blindly overwriting it. Or better — the watcher should skip reloading files that have a pending auto-save or recent local edit. Let me look at how `readSigil` works.

### Assistant (17:04 UTC)

*Files: [src/tauri.ts](../../src/tauri.ts)*

`readSigil` is a Rust command that reads the entire tree from disk. The reload replaces the whole spec. The clean fix: after `reload()` returns the fresh spec, **graft the locally-edited content back** before dispatching. This eliminates the race at its source — the watcher can detect structural changes (new children, renames) while the editor's content is never clobbered.

Let me implement this properly. The right place is in `WorkspaceShell` where `reload()` is called, or better yet, in `reload()` itself. But `reload` is generic — it shouldn't know about editor state. The cleanest approach: in `WorkspaceShell`, after `reload()`, graft the local content back before the dispatch happens.

Actually, even simpler: `reload()` calls `dispatch({ type: "UPDATE_SPEC", spec })`. If we make `reload` return the spec without dispatching, we can patch it in WorkspaceShell. But that changes the reload API. Let me look at what's cleaner.

The simplest structural fix: make the watcher callback preserve the edited node's content from CodeMirror. The watcher already knows `pendingPath` — it has access to `getAutoSavePendingContent()`. But really, the current CodeMirror content is the authority, not the pending auto-save content.

Let me redesign this. The problem is `reload()` dispatches `UPDATE_SPEC` with the full disk spec. I'll split it: have `reload` return the spec without dispatching, then the watcher grafts local content back before dispatching.

### Assistant (17:04 UTC)

*Files: [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx)*

Let me check who else calls `reload()` to understand if I can change its contract.

### Assistant (17:04 UTC)

`reload()` is called from OntologyTree (after user-initiated structural changes like create/rename/delete) and from `useActionDeps`. Those callers *want* the full disk read to replace everything — that's correct after a structural mutation. The problem is only in the file-watcher path, where the reload should preserve locally-edited content.

The clean design: split `reload` into `readSpec` (returns spec, no dispatch) and `reload` (reads + dispatches). The watcher uses `readSpec`, grafts local content, then dispatches itself.

### Assistant (17:04 UTC)

*Files: [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx)*

Now rewrite the watcher callback. Instead of calling `reload()` (which dispatches the raw disk spec), it should call `readSpec()`, graft the local editor content back onto the node being edited, then dispatch.

### Assistant (17:04 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now I need to understand what shape the locally-edited content takes. The watcher needs to graft back the `language` field of the folder being edited. Let me check what `scopeInfo` and `findContext` give us so I can reconstruct the path.

### Assistant (17:04 UTC)

Good. Now I see the pattern from `Workspace.tsx` `handleContentChange` (line 234-246): it uses `updateFolderInTree` to patch the spec. The watcher should do the same thing — after reading from disk, graft back the current editor content. The editor content lives in CodeMirror, which is the source of truth. But the watcher doesn't have access to CodeMirror.

The content *is* accessible though: `getAutoSavePendingContent()` has the last content that was passed to `save()`, and the `handleContentChange` callback passes the current CodeMirror text to `save()` on every keystroke. Wait — actually `handleContentChange` calls `save(path, content)` immediately (not debounced), so `getAutoSavePendingContent()` always has the latest editor text while a save is pending.

But there's a gap: after auto-save fires and clears the pending state, `getAutoSavePendingContent()` returns `null`. The user might have stopped typing, auto-save completed, but the 1000ms watcher hasn't fired yet. When it does, there's no pending content to graft back — but the content in the spec tree (from the 300ms debounce) is correct. So the real question is: does the watcher's `readSigil` overwrite that tree?

Yes — that's exactly the problem. `reload()` replaces the entire spec with disk content. Even when auto-save has completed and the disk is up-to-date, there's a window where the 300ms debounce updated the spec tree with newer content than what's on disk (because auto-save is 500ms).

The cleanest approach: the watcher graft should use the *current spec tree's language* for the edited node, not the disk version. The disk read gives us structural changes; the local tree has the authoritative content for the node being edited.

### Assistant (17:04 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

This `updateFolderInTree` is local to Workspace.tsx. I'll need to either export it or duplicate the logic. Actually it's small enough that I can use `findContext` from sigil-core to read the current language, then do the graft. But let me think about a simpler approach.

The real insight: the watcher's job is to update the *structure* (new children, renames, deleted files, affordances/invariants changed by external processes). It should NOT touch the `language` field of the node currently being edited. The simplest graft: after `readSpec()`, find the currently-edited node in the *old* spec, find the same node in the *new* spec, and copy the old `language` over.

### Assistant (17:05 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now update the watcher callback and the destructured actions:

### Assistant (17:05 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now rewrite the watcher callback to graft local content:

### Assistant (17:05 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now I need to add the `graftLanguage` helper. Let me add it before the component:

### Assistant (17:05 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

I need to check what `WorkspaceState` looks like to type the helper correctly:

### Assistant (17:05 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Now — with the root cause fixed, the LanguageEditor's sync effect no longer needs the compensating guards. The `content` prop will never arrive stale from a watcher reload because the watcher grafts local content back. Let me simplify the LanguageEditor effect back to something clean:

### Assistant (17:06 UTC)

*Files: [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Now clean up the refs that were only there to support the old guards:

### Assistant (17:06 UTC)

*Files: [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Now remove the refs from the updateListener too — they were set there:

### Assistant (17:06 UTC)

*Files: [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Let me type-check:

### Assistant (17:06 UTC)

`reload` is no longer used in WorkspaceShell — the watcher now uses `readSpec` + manual dispatch. Remove it:

### Assistant (17:06 UTC)

*Files: [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx)*

Clean — only the pre-existing `narration.ts` error remains.

Here's what was wrong and what changed.

**The decoherence:** Three independent timers updating three representations of the same content. CodeMirror (instant), React state (300ms debounce), and disk (500ms auto-save). A fourth actor — the file watcher (1000ms) — would read disk and replace the *entire* spec tree, overwriting the React state with whatever disk had. The LanguageEditor then had to decide whether to trust the incoming `content` prop or ignore it. That decision required `localEditRef`, `lastLocalContentRef`, base-content tracking — layers of compensation for a fundamentally broken data flow.

**The fix:** The watcher now calls `readSpec()` (no dispatch), then *grafts* the locally-edited node's language from the current spec tree onto the disk-read spec before dispatching. Structure comes from disk (new children, renames, external changes). Content for the edited node comes from the local tree. The two never fight.

LanguageEditor's sync effect collapses to: replace doc on navigation, skip everything else. No flags, no last-content tracking, no race windows.
