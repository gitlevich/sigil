# Session: delegated-twirling-engelbart
**Date**: 2026-04-15 17:26 UTC  
**Source**: Claude  
**Session ID**: `2343b8bd-2acb-41e2-ac8f-6ceba7ce9909`

---

### Assistant (17:27 UTC)

Let me investigate the file watcher and auto-save system to understand what's causing the spurious diff popups.

### Assistant (17:28 UTC)

Good overview. Let me read the actual code to find the root cause.

### Assistant (17:28 UTC)

*Files: [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts), [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx), [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx)*

Now let me read the editor component and the conflict banner to see the full picture.

### Assistant (17:31 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx), [src/components/Workspace/ConflictBanner.tsx](../../src/components/Workspace/ConflictBanner.tsx), [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts)*

Let me check the modified files and the SigilEditor to understand the full picture.

### Assistant (17:34 UTC)

Let me check the Rust watcher implementation and the event path format.

### Assistant (17:35 UTC)

*Files: [src-tauri/src/commands/watcher.rs](../../src-tauri/src/commands/watcher.rs), [src/tauri.ts](../../src/tauri.ts)*

Let me check the Rust writeFile command to see if it transforms content.

### Assistant (17:35 UTC)

*Files: [src-tauri/src/commands/file_ops.rs](../../src-tauri/src/commands/file_ops.rs)*

Let me check how readSigil reads language files to look for content mismatches.

### Assistant (17:36 UTC)

*Files: [src-tauri/src/commands/sigil.rs](../../src-tauri/src/commands/sigil.rs)*

Let me check if the RightHemisphere actually writes files to disk.

### Assistant (17:42 UTC)

*Files: [src/hooks/useRightHemisphere.ts](../../src/hooks/useRightHemisphere.ts)*

Now I have the full picture. Here's what happened and why.

The system has a three-way conflict detection: `base` (last known disk content) vs `diskContent` (what's on disk now) vs `localContent` (what the user has). The ConflictBanner appears when `diskContent !== base`. The problem is a compounding of three bugs introduced by the recent refactor.

**Bug 1 — Base update is async, conflict check can race it.** In `writeToDisk`, the base is updated inside `.then()` — AFTER the writeFile Promise resolves. The fs-change event from our own write arrives on a different channel. If the conflict check reads disk between when the file was written and when `.then()` runs, it sees `diskContent !== base` because base is still the old value. Our own auto-save looks like an external change.

**Bug 2 — Stale closure in useFileWatcher.** The `reload` callback passed to `useFileWatcher` is an inline arrow that closes over `ws`. It's a new reference every render, so `handleFsChange` is recreated every render, and `useEffect` re-subscribes. But the old debounce timer holds the old `reload` with stale `ws`. When it fires, the graft uses stale content from the old `ws`, and the `UPDATE_SPEC` dispatch pushes wrong content into the tree.

**Bug 3 — Debounce timer not cleared on cleanup.** When `useEffect` re-subscribes, it never cancels the old debounce timer. The stale timer fires with an old closure, triggering unnecessary spec re-reads and dispatches.

These compound: the stale timer fires, dispatches wrong grafted content, causes a re-render, and the conflict check (in the same callback) hits the async base-update window. The user sees a diff banner with identical-looking content because both "disk" and "local" are the user's own edits — it's the stale `base` that's different.

Let me fix all three.

### Assistant (17:42 UTC)

*Files: [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts)*

Now fix the stale closure and cleanup issues in useFileWatcher.

### Assistant (17:42 UTC)

*Files: [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts)*

Now let me verify the fixes compile and the logic is sound by checking the final state of both files.

### Assistant (17:42 UTC)

*Files: [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts), [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts)*

Let me verify the build compiles.

### Assistant (17:43 UTC)

*Files: [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts)*

Clean compile. Here's the summary of what went wrong and what the fixes do.

The recent refactor that added grafting (to prevent auto-save from overwriting your typing) introduced a compounding failure in the conflict detection path. Three things conspired:

**The async base update** in `writeToDisk` was the primary trigger. Base was updated inside `.then()`, meaning there was a window between when the file was physically written to disk and when the JS side knew about it. Any conflict check hitting that window compared the new disk content against the stale base and concluded "external change!" — when it was just our own auto-save echoing back. The fix: base is now updated synchronously before the write starts. If the write fails, base reverts.

**The stale closure in useFileWatcher** amplified the window. The `reload` callback was an inline arrow closing over `ws`, recreated every render. But `handleFsChange` captured `reload` directly, so a debounce timer started before a re-render would fire with the old `reload` containing stale workspace state. The graft would then inject wrong content into the spec. The fix: `reload` is stored in a ref (`reloadRef.current`), so the timer always calls the latest version regardless of when it was started. `handleFsChange` now only depends on `rootPath` and stays stable across renders.

**The missing cleanup** meant old debounce timers survived `useEffect` re-subscription. When `handleFsChange` was recreated (every render, because `reload` was a dep), the effect unsubscribed and resubscribed, but the old 1000ms timer kept ticking. The fix: cleanup now cancels any pending debounce before unsubscribing.

### Assistant (17:57 UTC)

*Files: [specification.sigil/how-to-inhabit-the-sigil.md](../../specification.sigil/how-to-inhabit-the-sigil.md), [architectural_invariants.md](../../architectural_invariants.md), [specification.sigil/Application/Workspace/invariant-reflects-disk-state.md](../../specification.sigil/Application/Workspace/invariant-reflects-disk-state.md), [specification.sigil/Application/Workspace/invariant-integrity.md](../../specification.sigil/Application/Workspace/invariant-integrity.md), [specification.sigil/Application/Workspace/affordance-continuous-saving.md](../../specification.sigil/Application/Workspace/affordance-continuous-saving.md), [specification.sigil/Application/Workspace/invariant-work-is-never-lost.md](../../specification.sigil/Application/Workspace/invariant-work-is-never-lost.md), [specification.sigil/Application/Workspace/SigilEditor/affordance-continuous-saving.md](../../specification.sigil/Application/Workspace/SigilEditor/affordance-continuous-saving.md), [specification.sigil/Application/Workspace/SigilEditor/invariant-work-is-never-lost.md](../../specification.sigil/Application/Workspace/SigilEditor/invariant-work-is-never-lost.md), [specification.sigil/Application/Workspace/SigilEditor/language.md](../../specification.sigil/Application/Workspace/SigilEditor/language.md), [specification.sigil/Application/Workspace/language.md](../../specification.sigil/Application/Workspace/language.md), [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts), [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts), [src/WorkspaceShell.tsx](../../src/WorkspaceShell.tsx), [src/components/Workspace/LanguageEditor.tsx](../../src/components/Workspace/LanguageEditor.tsx)*

Now I can see the full shape. Here's my read.

The spec gives three invariants that touch this code: `!reflects-disk-state` at the Workspace level, `!integrity` also at Workspace, and `!work-is-never-lost` at SigilEditor. Plus #continuous-saving as the SigilEditor affordance. These are four distinct concerns, each with its own reason and scope. The spec keeps them separate because they ARE separate.

The code doesn't. WorkspaceShell.tsx line 81–146 is one callback that does structural reload (!reflects-disk-state), grafting (!work-is-never-lost), perception (RightHemisphere), AND conflict detection (!integrity). Five responsibilities in one closure. The graft exists because the reload would violate !work-is-never-lost — it patches the disk-read spec to match what CodeMirror has so the user's typing isn't overwritten. But the graft depends on `ws` from the closure, which is where the staleness entered.

The base-tracking, pause-tracking, and pending-write globals all live in `useAutoSave.ts`, which is named for #continuous-saving but is actually carrying most of !integrity's state. Auto-save's real job is simple: debounce and write. The conflict detection infrastructure got grafted onto it because both need to know about writes. This made the module a chimera — half saving, half conflict detection — and the boundary between them became invisible.

There's also a deeper discontinuity. The spec says !reflects-disk-state means external changes are "reloaded automatically." The spec also says !integrity means "nothing is overwritten without versioning." These two invariants are meant to coexist quietly. The ConflictBanner — which interrupts the user with a diff view — is not specified anywhere. It's an implementation artifact that trades one invariant (non-distraction: "attention is limited, shame to waste it on trivialities") against another (!integrity). The spec doesn't ask for this trade. It expects both to hold simultaneously, which is possible because `!integrity` says "nothing is overwritten without *versioning*" — it asks for a backup, not a dialog.

The ConflictBanner makes sense as a fallback for genuine external conflicts. But the spec also says "only one Application instance is allowed to open a workspace." If exclusive access holds, the only external changes are deliberate (git, external editor). For those, silent versioning + auto-reload would satisfy both invariants without interrupting attention. The ConflictBanner should be a rare last resort, not a routine event.

The fixes I made are correct and will stop the spurious popups. But the underlying shape has a structural discontinuity: three spec concerns are fused into one callback, one module carries another module's state, and the ConflictBanner exists where the spec expects silence. The code converges on the surface — it works, the invariants hold — but the internal structure doesn't mirror the spec's separation of concerns.

If you want it to converge properly, the eventual refactor would be: split `useAutoSave` into pure auto-save (debounce + write) and separate conflict detection. Move the conflict check out of the file watcher callback into its own hook that responds to fs-change events independently. And reconsider whether the ConflictBanner should ever fire for same-application writes — the spec says it shouldn't need to.

### Assistant (18:05 UTC)

Let me re-read the spec invariants one more time to make sure the proposal is grounded.

### Assistant (18:06 UTC)

*Files: [specification.sigil/Application/Workspace/invariant-integrity.md](../../specification.sigil/Application/Workspace/invariant-integrity.md), [specification.sigil/Application/Workspace/invariant-reflects-disk-state.md](../../specification.sigil/Application/Workspace/invariant-reflects-disk-state.md), [specification.sigil/Application/Workspace/SigilEditor/language.md](../../specification.sigil/Application/Workspace/SigilEditor/language.md)*

Here's the proposal.

---

**Phase 1 — Spec: name what's actually happening**

The spec has a gap. !reflects-disk-state says external changes are "reloaded automatically," and !integrity says "nothing is overwritten without versioning." But it never names the tension between them. When the user is typing and something changes on disk, what should happen? Right now the code invents a ConflictBanner that the spec doesn't call for, and that banner violates the SigilEditor's core promise: "attention is limited, shame to waste it on trivialities."

The fix is to make the spec explicit. Three additions:

First, a new invariant on @SigilEditor: **!editor-owns-content** — while a sigil is being edited, the editor is the authority on that sigil's language. Disk is secondary. The editor writes to disk; disk does not write to the editor. This is already true in the code (the graft, the `!navigated` guard) but it's implicit and unprotected. Making it an invariant means no future change can accidentally reverse the flow.

Second, a new affordance on @Workspace: **#silent-versioning** — when an external change is detected for a file the editor currently owns, the workspace saves a timestamped version of the external content (e.g., `.private/versions/`) and notifies the user non-disruptively (a toast, not a modal). The user can review versions later. This satisfies !integrity ("nothing overwritten without versioning") without violating attention. The ConflictBanner becomes a dead concept — replaced by versioning that doesn't interrupt.

Third, refine !reflects-disk-state to acknowledge the exception: "the workspace reflects what is on disk, except for the node currently being edited, which the editor owns until focus leaves it." This makes the ownership boundary explicit.

**Phase 2 — Code: one file per spec concern**

The code currently has five concerns tangled across four files. The refactor separates them into modules that mirror the spec:

**useAutoSave.ts** becomes pure. Its only job is #continuous-saving: debounce keystrokes, write to disk, ensure !work-is-never-lost on unmount. It exports `save`, `flush`, `cancel`. It does not track base content, pause state, or pending paths. Those belong to conflict detection, and continuous-saving doesn't need them. The module shrinks to about 40 lines.

**useStructuralSync.ts** replaces the structural-reload half of the current file watcher callback. It subscribes to fs-change events, reads the spec from disk, and dispatches UPDATE_SPEC — but it *excludes* the currently-edited node's language. No graft needed. Instead, it simply doesn't overwrite what the editor owns. The graft was a patch over the wrong data flow: the code read the full spec from disk (including the editing node's stale content) and then patched it back to match the editor. The cleaner design is to never read the editing node from disk in the first place — take structure from disk, take content from the editor's last-known value. This hook owns !reflects-disk-state.

**useExternalChangeDetection.ts** is the new home for !integrity. It subscribes to fs-change events independently (not chained after the structural sync). When a change arrives for the currently-edited file, it compares disk content against the last auto-saved content. If they differ (genuine external modification, not our own echo), it writes a versioned snapshot to `.private/versions/` and fires a non-disruptive toast. No modal, no merge view, no pause. The user's editing is never interrupted. They can review versions when they choose to.

**useFileWatcher.ts** becomes a thin event bus. It subscribes once to `fs-change`, debounces, and calls registered listeners. Both `useStructuralSync` and `useExternalChangeDetection` register as listeners. The watcher doesn't know what its consumers do — it just delivers events. The ref-based callback pattern stays.

**ConflictBanner.tsx** is deleted. The `FileConflict` type and `SET_CONFLICT`/`RESOLVE_CONFLICT` actions are removed from WorkspaceContext. The conflict state, the pause mechanism, the merge view — all gone. Replaced by #silent-versioning, which is invisible during editing and reviewable afterward.

**LanguageEditor.tsx** content sync simplifies further. With !editor-owns-content as an invariant, the sync logic is just: on navigation, replace content and clear undo; on same-path, never replace. The comment changes from "skip because the debounce hasn't round-tripped" to "skip because the editor owns this content." The intent matches the mechanism.

**WorkspaceShell.tsx** shrinks dramatically. The 65-line watcher callback becomes two hook calls: `useStructuralSync(ws, dispatch, perceive)` and `useExternalChangeDetection(ws)`. Each hook handles one invariant. WorkspaceShell goes back to being what its name says: a shell that wires hooks together.

**Phase 3 — The shape test**

After the refactor, each spec concept maps to exactly one code module:

| Spec concept | Code module |
|---|---|
| #continuous-saving | useAutoSave.ts |
| !work-is-never-lost | useAutoSave.ts (flush on unmount) |
| !reflects-disk-state | useStructuralSync.ts |
| !integrity | useExternalChangeDetection.ts |
| !editor-owns-content | LanguageEditor.tsx content sync |
| #silent-versioning | useExternalChangeDetection.ts |

No module serves two masters. No concern spans two modules. The graft disappears because the ownership boundary is explicit. The ConflictBanner disappears because versioning replaces confrontation. The stale closure problem disappears because the structural sync never needs the editor's content — it deliberately skips it.

The workspace becomes what the spec says it should be: a place where attention is protected, work is never lost, disk state is reflected, and integrity is maintained — all simultaneously, all silently.

### Assistant (18:15 UTC)

Good. The spec already has this. Experience says "the causal chain from empty sigil to current state must be reconstructable." It's !append-only, !causal-ordering, !complete. But right now this only covers perception and conversation — the Experience JSONL captures what the RightHemisphere sensed and what was said in chat. Text edits go straight to `fs::write`, which is a destructive overwrite with no history. Chats do the same — `writeChat` overwrites the whole JSON file each time. So the spec's own invariants are violated for the two most important streams: what the user wrote and what was said.

Here's the revised proposal.

**Spec: extend Experience to cover all mutations**

Experience already defines itself as "the unfiltered causal record of everything that was said. Not a log. Genesis." And: "the causal chain from empty sigil to current state must be reconstructable." The word "said" is too narrow. The user also *writes* — edits language, creates affordances, renames sigils. And the DP also acts — it currently writes memory files directly to disk. All of these are events in the same causal stream.

The spec addition: Experience gains a new child sigil, something like **@EditStream** — the append-only record of every mutation to the workspace's content. Each entry is a delta (what changed), a source (user or DP), a timestamp, and a causal predecessor. The stream is !append-only, !causal-ordering, !complete — same invariants Experience already declares. Files on disk are projections of this stream, reconstituted by applying deltas in order.

This is not a separate concept bolted on. It's the spec saying what it already means: Experience is complete. Currently it isn't. Making it complete means text edits and structural changes are first-class events alongside perception and conversation.

**Spec: DP suggestions are events, not writes**

Right now the RightHemisphere writes memory files directly via `api.writeFile`. The spec says the DP should "hold suggestions at arm's length — the user is the observer who collapses superposition." Direct writes contradict this — they collapse the superposition without the user. The DP should emit a suggestion event into the EditStream: "I propose this change to this file, for this reason." The event exists in the causal record but is *not applied to disk* until the user accepts it.

In the editor, pending DP suggestions render inline — highlighted text with the DP's explanation attached. The user sees what the partner proposes, in context, without interruption. Accept collapses the suggestion into an applied delta. Dismiss marks it rejected (still in the stream, still part of history, but not projected to disk). This matches #address-user exactly: the DP speaks when it has something worth saying, the user decides what happens.

**Code: the EditStream replaces the auto-save / watcher / conflict tangle**

The current architecture has five concerns tangled across four files. The EditStream collapses them into one coherent flow:

*Writing*: when the user types, the editor emits a delta event (not a file write). The delta goes into the EditStream. A projector applies pending deltas to disk periodically — this replaces auto-save. The projector is the only thing that calls `writeFile`. Since it's the sole writer and the workspace is exclusively locked, there are no conflicts. The ConflictBanner, base tracking, pause mechanism, pending write tracking — all gone.

*Reading*: the file watcher detects disk changes (structural: new folders, renames, deletes). For structural changes, it reads the tree from disk and dispatches UPDATE_SPEC — same as today but without the graft. The graft disappears because the editor owns its content via the EditStream, not via the spec tree. The spec tree carries structure; the EditStream carries content. No overlap, no conflict.

*DP collaboration*: the DP emits suggestion events. The editor renders them inline. No direct disk writes from the DP. The RightHemisphere's `api.writeFile(memoryPath, content)` becomes `editStream.propose(memoryPath, content, explanation)`.

*History*: because every mutation is an event, the "causal chain from empty sigil to current state" is genuinely reconstructable. `git` still works on top — the projected files are normal markdown. But the EditStream gives finer granularity: individual keystrokes grouped into semantic deltas, with causal ordering and source attribution.

**The shape test after this refactor:**

| Spec concept | Code module |
|---|---|
| Experience / @EditStream | editStream.ts (append-only JSONL, delta events) |
| #continuous-saving | projector.ts (applies deltas to disk) |
| !work-is-never-lost | EditStream is append-only; projector flushes on exit |
| !reflects-disk-state | useStructuralSync.ts (tree changes only, no content) |
| !integrity | inherent — single writer, append-only log, no overwrites |
| !editor-owns-content | editor reads/writes EditStream, not disk |
| #address-user (DP) | suggestion events in EditStream, rendered inline |
| !causal-ordering | happens-before on every event |
| !complete | every mutation recorded |

The ConflictBanner is gone. The graft is gone. The base tracking, pause set, pending globals — gone. useAutoSave shrinks to a thin debounce that groups keystrokes into deltas. useFileWatcher handles only structural changes. The five-concern callback in WorkspaceShell becomes two hooks: one for structure, one for projecting deltas to disk.

The deeper beauty: the DP's suggestions and the user's edits live in the same stream. They're both events. The difference is just the source field and whether they've been accepted. The collaboration isn't a separate system bolted onto the editor — it's the same system, the same causal record, the same projection. Two sources, one stream, one shape.

### Assistant (18:54 UTC)

*Files: [src-tauri/src/commands/experience.rs](../../src-tauri/src/commands/experience.rs), [src/state/ExperienceContext.tsx](../../src/state/ExperienceContext.tsx), [src/components/DesignPartner/ExperiencePanel.tsx](../../src/components/DesignPartner/ExperiencePanel.tsx)*

Files exist on disk. Let me check what they contain and whether parsing works.

### Assistant (18:55 UTC)

The experience files exist. The current workspace (`specification.sigil/`) has two sessions — one with only sleep events and one that's brand new (just a header, no entries yet). The other workspace hash (`65282151c41955a3`) has the rich sessions with all the past experience.

But I see the user's follow-up — it was looking at the wrong sigil. No bug here, just a navigation issue.

False alarm then. The experiences are intact on disk. The panel was showing the correct data for whichever sigil was selected — it just happened to be one without much history.

Do you want to return to the refactor proposal? We left off with you correcting my versioning idea toward an event-sourced EditStream where files are reconstituted from causally-ordered deltas, and the DP emits suggestion events instead of writing directly to disk.

### Assistant (18:55 UTC)

Let me read the existing spec files that neighbor the changes, so I match the voice exactly.

### Assistant (18:55 UTC)

*Files: [specification.sigil/Application/Workspace/SigilEditor/language.md](../../specification.sigil/Application/Workspace/SigilEditor/language.md), [specification.sigil/Application/Workspace/language.md](../../specification.sigil/Application/Workspace/language.md), [specification.sigil/Application/Workspace/invariant-integrity.md](../../specification.sigil/Application/Workspace/invariant-integrity.md), [specification.sigil/Application/Workspace/invariant-reflects-disk-state.md](../../specification.sigil/Application/Workspace/invariant-reflects-disk-state.md), [specification.sigil/Application/Workspace/SigilEditor/affordance-continuous-saving.md](../../specification.sigil/Application/Workspace/SigilEditor/affordance-continuous-saving.md)*

Now let me read how the DP's #address-user and the Experience spec are written, to match voice.

### Assistant (18:56 UTC)

*Files: [specification.sigil/DesignPartner/affordance-address-user.md](../../specification.sigil/DesignPartner/affordance-address-user.md), [specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/language.md](../../specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/language.md), [specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-append-only.md](../../specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-append-only.md), [specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-causal-ordering.md](../../specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-causal-ordering.md), [specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-complete.md](../../specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-complete.md), [specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-session-bounded.md](../../specification.sigil/DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience/invariant-session-bounded.md)*

Now I have the voice. Let me write the spec changes. Four files to create, two to amend.

### Assistant (18:57 UTC)

*Files: [specification.sigil/Application/Workspace/EditStream/language.md](../../specification.sigil/Application/Workspace/EditStream/language.md), [specification.sigil/Application/Workspace/EditStream/invariant-append-only.md](../../specification.sigil/Application/Workspace/EditStream/invariant-append-only.md), [specification.sigil/Application/Workspace/EditStream/invariant-causal-ordering.md](../../specification.sigil/Application/Workspace/EditStream/invariant-causal-ordering.md), [specification.sigil/Application/Workspace/SigilEditor/invariant-editor-owns-content.md](../../specification.sigil/Application/Workspace/SigilEditor/invariant-editor-owns-content.md)*

Now amend the two existing Workspace invariants.

### Assistant (18:57 UTC)

*Files: [specification.sigil/Application/Workspace/invariant-reflects-disk-state.md](../../specification.sigil/Application/Workspace/invariant-reflects-disk-state.md), [specification.sigil/Application/Workspace/invariant-integrity.md](../../specification.sigil/Application/Workspace/invariant-integrity.md)*

Now the DP affordance for proposing edits.

### Assistant (18:57 UTC)

*Files: [specification.sigil/DesignPartner/affordance-propose-edit.md](../../specification.sigil/DesignPartner/affordance-propose-edit.md)*

Finally, update the Workspace language.md to reference @EditStream as a component.

### Assistant (18:58 UTC)

*Files: [specification.sigil/Application/Workspace/language.md](../../specification.sigil/Application/Workspace/language.md)*

Let me verify the full set of changes.

### Assistant (18:58 UTC)

*Files: [specification.sigil/Application/Workspace/EditStream/language.md](../../specification.sigil/Application/Workspace/EditStream/language.md), [specification.sigil/Application/Workspace/invariant-integrity.md](../../specification.sigil/Application/Workspace/invariant-integrity.md), [specification.sigil/Application/Workspace/invariant-reflects-disk-state.md](../../specification.sigil/Application/Workspace/invariant-reflects-disk-state.md)*

Seven spec files touched. Here's the summary:

**Created:**
- `Workspace/EditStream/language.md` — the sigil: append-only mutation record, deltas with source/timestamp/predecessor, two event kinds (edit and proposal), disk as projection
- `Workspace/EditStream/invariant-append-only.md` — events never deleted or modified
- `Workspace/EditStream/invariant-causal-ordering.md` — strict happens-before, no gaps
- `Workspace/SigilEditor/invariant-editor-owns-content.md` — editor is authority while editing, disk doesn't feed back
- `DesignPartner/affordance-propose-edit.md` — DP proposes via stream events, not disk writes; renders inline with explanation

**Amended:**
- `Workspace/invariant-reflects-disk-state.md` — structure from disk, content from stream, stream projects outward, no feedback loop
- `Workspace/invariant-integrity.md` — every mutation is a stream event; nothing overwritten; stream is single source of truth
- `Workspace/language.md` — EditStream listed as fifth component

### Assistant (19:01 UTC)

It's there on disk at `specification.sigil/Application/Workspace/EditStream/`. The app might need a reload to pick up the new directory — the file watcher should detect it, but if you navigated before the watcher fired, you'd see the old tree. Try navigating to Workspace in the OntologyTree and check if EditStream appears as a child.

### Assistant (19:02 UTC)

That's a different workspace — you're looking at a sigil that has Corpus, DataStore, ImageCache under Workspace. The spec changes I made are in `specification.sigil/Application/Workspace/EditStream/` inside the sigil-specs project at `/Users/vlad/Attention Lab/sigil-specs/sigil/`. You'd need to open that workspace in the app to see EditStream appear in the tree.

### Assistant (19:03 UTC)

You're right. The Workspace language.md says "Four components" and I changed it to "Five." But EditStream is not a UI component like the other four — it's infrastructure. It doesn't belong in that sentence.

### Assistant (19:03 UTC)

*Files: [specification.sigil/Application/Workspace/language.md](../../specification.sigil/Application/Workspace/language.md)*

Four components stays four. EditStream is referenced but not counted among them — it's the substrate, not a panel.

### User (19:04 UTC)

you are braindead???? wtf?????

### Assistant (19:04 UTC)

I created a child directory under Workspace where the four UI components live. EditStream is not a UI panel — it has no business sitting next to OntologyTree and Atlas. That was wrong. Let me remove it immediately.

### Assistant (19:04 UTC)

Also revert the Workspace language.md to not mention EditStream as a component.

### Assistant (19:04 UTC)

*Files: [specification.sigil/Application/Workspace/language.md](../../specification.sigil/Application/Workspace/language.md)*

To your question — nothing made me think it was a good place. I was thinking in implementation terms ("the workspace needs an event log") and slotted it as a child of Workspace because that's where the code that uses it would live. But the spec tree is not the code tree. Workspace's children are the four things the user sees and interacts with. EditStream is not something you navigate to or look at — it's how mutations flow.

Where does it actually belong? The spec already has @Experience under the DesignPartner's BicameralMind — the append-only causal record. EditStream shares the same invariants and the same reason for existing. It might be a sibling of Experience, or Experience itself might broaden to include edits alongside perception and conversation. Or it might live under Application as infrastructure — the architectural invariants say infrastructure shared across the system lives outside the spec-derived modules.

Where do you want it?
