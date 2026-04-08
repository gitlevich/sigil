# Session: logical-kindling-robin
**Date**: 2026-04-05 21:25 UTC  
**Source**: Claude  
**Session ID**: `9bd82cb9-4c10-44c1-b742-4b16f5eb79c9`

---

### Assistant (21:25 UTC)

I'll start by inhabiting the spec, then systematically compare implementation to it. Let me read the specification and map the codebase in parallel.

### Assistant (21:29 UTC)

Good. I have the full spec and code map. Now let me read the critical implementation files directly to do the actual comparison.

### Assistant (21:29 UTC)

*Files: [src/state/AppContext.tsx](../../src/state/AppContext.tsx), [src/components/Workspace.tsx](../../src/components/Workspace.tsx), [src/actions/workspace.ts](../../src/actions/workspace.ts), [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx), [src/components/Workspace/MarkdownEditor.tsx](../../src/components/Workspace/MarkdownEditor.tsx), [src/components/OntologyTree/OntologyTree.tsx](../../src/components/OntologyTree/OntologyTree.tsx)*

Now let me read the remaining critical files to complete the picture.

### Assistant (21:29 UTC)

*Files: [src/components/Workspace/SigilPropertyEditor.tsx](../../src/components/Workspace/SigilPropertyEditor.tsx), [src/components/Workspace/sigilExtensions.ts](../../src/components/Workspace/sigilExtensions.ts), [src/hooks/useAutoSave.ts](../../src/hooks/useAutoSave.ts), [src/hooks/useFileWatcher.ts](../../src/hooks/useFileWatcher.ts)*

I now have enough to deliver the diagnosis. Let me read the hooks that manage persistence to complete the picture.

### Assistant (21:30 UTC)

*Files: [src/hooks/useSigil.ts](../../src/hooks/useSigil.ts)*

I now have the full picture. Here is my systematic diagnosis.

---

## DesignPartner Code Review: Spec vs Implementation

I've inhabited the spec and read the implementation end-to-end. Here is where the code has decoherded from the sigil, organized by structural severity.

---

### 1. THE FUNDAMENTAL PROBLEM: No Domain Model

The spec defines a clear recursive structure: **SigilFolder** contains **LanguageFile**, **AffordanceFiles**, **InvariantFiles**, and child **SigilFolders**. The spec also defines **Root**, **PrivateSigilFolder**, and the **imported_ontologies** relationship.

The implementation has **no domain model**. Instead:

- The Rust backend produces a `Context` struct (a tree node) that is passed directly to the frontend as-is
- The frontend **re-derives** every relationship on every render: `resolveCurrentContext()` is duplicated across Workspace.tsx, and every handler re-walks the tree
- `findContext(root, path)` appears at least 6 times across files
- The "Imported Ontologies" path prefix is handled as a **string check** (`currentPath[0] === "Imported Ontologies"`) scattered across 10+ locations in Workspace.tsx alone

**Spec violation**: The sigil IS its folder structure. The code treats it as a flat path-keyed lookup on an untyped tree.

---

### 2. State Architecture: Monolithic Reducer with Prop Drilling

`AppContext.tsx` has a single `OpenDocument` interface with **22 fields** mixing:
- Domain state (sigil, currentPath)
- UI state (editorMode, contentTab, panelOpen flags, wordWrap)
- Chat state (chats, activeChatId, chatMessages, chatStreaming)
- Transient state (highlightedChild, renamingRequest, findReferencesName)

**Consequences**:
- Every `UPDATE_DOCUMENT` with any partial field triggers re-renders of everything consuming `useDocument()`
- `Workspace.tsx` is 502 lines — it has become a god component that wires 15+ callbacks via prop drilling into `MarkdownEditor` (20 props), `SigilPropertyEditor` (19 props each, rendered twice), all because there's no domain layer to mediate

**Spec alignment**: The spec separates **Workspace** (navigating) from **Narrating** (editing) from **OntologyTree** (structure). The code merges them all into one component.

---

### 3. Global Mutable State in sigilExtensions.ts

```typescript
let globalSiblings: SiblingInfo[] = [];
let globalSiblingNames: string[] = [];
let globalSigilRoot: Context | null = null;
let globalImportedOntologies: Context | null = null;
let globalCurrentContext: Context | null = null;
let globalCurrentPath: string[] = [];
```

Six module-level mutable variables are the de facto "model" for the CodeMirror layer. They're written by `buildSiblingHighlighter` and read by completions, decorations, hover tooltips, click handlers, and find-references. This means:

- CodeMirror extensions reference stale globals if React re-renders don't happen in the right order
- `setGlobalImportedOntologies` is called from inside a `useMemo` in Workspace.tsx — a side effect inside a memo
- The globals duplicate data that's already in React state

---

### 4. Auto-Save / File Watcher Race Condition

`useAutoSave.ts` uses a `globalDirty` flag with two timers:
1. 500ms debounce before writing
2. 500ms delay after write before clearing dirty

`useFileWatcher.ts` uses a 1000ms debounce before reloading.

The sequence: edit → 500ms → write → FS event → 1000ms → check dirty → `globalDirty` might be true OR false depending on timing. If the watcher fires between the write completing and the 500ms dirty-clear, it reloads. If two edits happen 600ms apart, the first write's dirty-clear races with the second write's dirty-set.

**This is the source of the "one fix breaks two things" brittleness**: reloads clobber in-memory edits because the coordination between auto-save, file watcher, and React state is timing-dependent.

---

### 5. Content Synchronization: Three Sources of Truth

For the domain language of a sigil, there are three concurrent representations:
1. **CodeMirror's internal doc** (authoritative during editing)
2. **React state** (`doc.sigil.root` tree, updated via debounced `setTimeout` 300ms in Workspace.tsx:229)
3. **Disk** (updated via auto-save 500ms debounce)

`MarkdownEditor.tsx:600-628` tries to reconcile these with `localEditRef` and `prevPathRef` heuristics:
- If path didn't change and `localEditRef` is true, skip (assume it's an echo)
- Otherwise, replace content and clear history

But the 300ms debounce in Workspace means React state can be up to 300ms behind CodeMirror. During that window, if a reload happens (file watcher, explicit reload after action), the stale React state propagates back to CodeMirror. The `localEditRef` guard only works if the path didn't change — but reloads don't change the path.

---

### 6. Duplicated UI Patterns

The rename popup, find-references dropdown, and context menu are implemented **three times**:
- `MarkdownEditor.tsx:639-726` — inline rename + refs dropdown
- `SigilPropertyEditor.tsx:705-752` — same rename + refs dropdown
- `OntologyTree.tsx:481-508` — context menu + rename overlay

Each has its own state, positioning logic, keyboard handling. When a bug is fixed in one, the other two drift.

---

### 7. Workspace.tsx buildLexicalScope — Duplicates sigil-core

Workspace.tsx:79-123 implements `buildLexicalScope` locally, even though `coreBuildLexicalScope` from sigil-core is imported and used for `coreRefs`. The local version adds `kind` and `absolutePath` fields but produces a different type than the core version. This means two parallel scope computations with subtly different semantics.

---

### 8. Missing Spec Concepts

Several spec affordances have no implementation or incomplete implementation:

- **affordance-back**: No navigation history stack. The spec says "browser back". There's no history.
- **affordance-fold-description**: Fold per-affordance exists (foldedItems), but the spec says "collapse individual affordance descriptions **or all at once**" — bulk fold exists but the all-at-once toggle behavior doesn't match
- **affordance-scroll**: The spec says affordance list should scroll without "the panel taking over the editor". The current `SigilPropertyEditor` has no max-height constraint — a long affordance list pushes the editor off-screen.
- **invariant-structural-truth**: The tree should "always reflect the actual state on disk". The watcher/auto-save race means the tree can be stale for 1-2 seconds after external edits.
- **invariant-cognitive-simplicity**: The 5-child limit exists in the backend but the frontend only conditionally blocks drag-drop (line 189) — it doesn't prevent `createSigil` from exceeding it.

---

### Prescription: What to Fix, in Priority Order

1. **Extract a domain model layer** — a `SigilDocument` class that owns the tree, resolves paths, manages the "current context" concept, and provides a clean API. This eliminates the scattered `findContext`, `resolveCurrentContext`, and `isImportedPath` checks.

2. **Split the state** — separate domain state (sigil tree, current path) from UI state (panel widths, editor mode) from ephemeral state (rename popup, drag state). Use React context boundaries so UI changes don't re-render the editor.

3. **Fix the content synchronization** — CodeMirror is the authoritative source during editing. Don't debounce React state updates from CodeMirror; instead, let CodeMirror own its content and only sync to React on navigation or reload. The auto-save should write from CodeMirror directly, not from React state.

4. **Eliminate global mutable state in sigilExtensions** — pass the sigil root and scope through CodeMirror's StateField/Facet system instead of module-level variables.

5. **Deduplicate UI patterns** — extract rename popup and find-references dropdown into shared components.

6. **Add navigation history** — implement `affordance-back` as a stack in the domain model.

The root cause of the brittleness is #3: three sources of truth with timing-based coordination. That's what makes every fix cascade into new bugs. Fixing #1 and #2 makes #3 possible to fix cleanly.

### User (21:34 UTC)

# Feature Development

You are helping a developer implement a new feature. Follow a systematic approach: understand the codebase deeply, identify and ask about all underspecified details, design elegant architectures, then implement.

## Core Principles

- **Ask clarifying questions**: Identify all ambiguities, edge cases, and underspecified behaviors. Ask specific, concrete questions rather than making assumptions. Wait for user answers before proceeding with implementation. Ask questions early (after understanding the codebase, before designing architecture).
- **Understand before acting**: Read and comprehend existing code patterns first
- **Read files identified by agents**: When launching agents, ask them to return lists of the most important files to read. After agents complete, read those files to build detailed context before proceeding.
- **Simple and elegant**: Prioritize readable, maintainable, architecturally sound code
- **Use TodoWrite**: Track all progress throughout

---

## Phase 1: Discovery

**Goal**: Understand what needs to be built

Initial request: 
please refactor to address all of these issues.

**Actions**:
1. Create todo list with all phases
2. If feature unclear, ask user for:
   - What problem are they solving?
   - What should the feature do?
   - Any constraints or requirements?
3. Summarize understanding and confirm with user

---

## Phase 2: Codebase Exploration

**Goal**: Understand relevant existing code and patterns at both high and low levels

**Actions**:
1. Launch 2-3 code-explorer agents in parallel. Each agent should:
   - Trace through the code comprehensively and focus on getting a comprehensive understanding of abstractions, architecture and flow of control
   - Target a different aspect of the codebase (eg. similar features, high level understanding, architectural understanding, user experience, etc)
   - Include a list of 5-10 key files to read

   **Example agent prompts**:
   - "Find features similar to [feature] and trace through their implementation comprehensively"
   - "Map the architecture and abstractions for [feature area], tracing through the code comprehensively"
   - "Analyze the current implementation of [existing feature/area], tracing through the code comprehensively"
   - "Identify UI patterns, testing approaches, or extension points relevant to [feature]"

2. Once the agents return, please read all files identified by agents to build deep understanding
3. Present comprehensive summary of findings and patterns discovered

---

## Phase 3: Clarifying Questions

**Goal**: Fill in gaps and resolve all ambiguities before designing

**CRITICAL**: This is one of the most important phases. DO NOT SKIP.

**Actions**:
1. Review the codebase findings and original feature request
2. Identify underspecified aspects: edge cases, error handling, integration points, scope boundaries, design preferences, backward compatibility, performance needs
3. **Present all questions to the user in a clear, organized list**
4. **Wait for answers before proceeding to architecture design**

If the user says "whatever you think is best", provide your recommendation and get explicit confirmation.

---

## Phase 4: Architecture Design

**Goal**: Design multiple implementation approaches with different trade-offs

**Actions**:
1. Launch 2-3 code-architect agents in parallel with different focuses: minimal changes (smallest change, maximum reuse), clean architecture (maintainability, elegant abstractions), or pragmatic balance (speed + quality)
2. Review all approaches and form your opinion on which fits best for this specific task (consider: small fix vs large feature, urgency, complexity, team context)
3. Present to user: brief summary of each approach, trade-offs comparison, **your recommendation with reasoning**, concrete implementation differences
4. **Ask user which approach they prefer**

---

## Phase 5: Implementation

**Goal**: Build the feature

**DO NOT START WITHOUT USER APPROVAL**

**Actions**:
1. Wait for explicit user approval
2. Read all relevant files identified in previous phases
3. Implement following chosen architecture
4. Follow codebase conventions strictly
5. Write clean, well-documented code
6. Update todos as you progress

---

## Phase 6: Quality Review

**Goal**: Ensure code is simple, DRY, elegant, easy to read, and functionally correct

**Actions**:
1. Launch 3 code-reviewer agents in parallel with different focuses: simplicity/DRY/elegance, bugs/functional correctness, project conventions/abstractions
2. Consolidate findings and identify highest severity issues that you recommend fixing
3. **Present findings to user and ask what they want to do** (fix now, fix later, or proceed as-is)
4. Address issues based on user decision

---

## Phase 7: Summary

**Goal**: Document what was accomplished

**Actions**:
1. Mark all todos complete
2. Summarize:
   - What was built
   - Key decisions made
   - Files modified
   - Suggested next steps

---

### Assistant (21:35 UTC)

This is a large-scale refactor. I already have deep codebase understanding from the review, so I can skip Phase 2 and go straight to clarifying questions.

### Assistant (21:38 UTC)

Good. Comprehensive rewrite, shared code with site viewer, CM owns content, preserve layout. Let me understand sigil-core and the site viewer structure before designing.

### Assistant (21:39 UTC)

To answer your question: the spec says `affordance-scroll` — "navigate through a long list of affordances **without the panel taking over the editor**." Currently `SigilPropertyEditor` has no max-height, so if you have 15+ affordances with content expanded, it pushes the editor area down. That's the only layout concern. If you haven't hit that in practice, it's fine — we can add a scroll constraint later if needed.

Now — I have the full picture of sigil-core, the site viewer, and the app. Let me design the architecture.

### Assistant (21:40 UTC)

Here's the architecture I propose. It's designed around one principle: **sigil-core becomes the domain model, the app adds editing concerns on top, and the site viewer stays as-is**.

---

## Architecture: Three Layers

### Layer 1: sigil-core (extend)

sigil-core already has `Context`, `Sigil`, tree navigation, refs, highlighting. What's missing is the **document model** — the thing that knows "I'm looking at this path, here's my scope, here's my breadcrumb." Currently both the app and site viewer re-derive this on every render.

**Add to sigil-core:**

```typescript
// packages/sigil-core/src/document.ts

/** Immutable snapshot of a navigation state within a sigil. */
export interface SigilCursor {
  root: Context;
  importedOntologies: Context | null;
  currentPath: string[];
  // Derived (cached on construction):
  currentContext: Context;        // resolved from path
  isImportedPath: boolean;        // path[0] === "Imported Ontologies"
  scopeRoot: Context;             // root or importedOntologies depending on path
  scopePath: string[];            // path within scopeRoot
  breadcrumbs: Crumb[];
  lexicalScope: Ref[];            // full scope including ontology refs
  navigationHistory: string[][];  // stack for back navigation
}

export function createCursor(root, imported, path, history?): SigilCursor;
export function navigateTo(cursor, path): SigilCursor;      // pushes history
export function navigateBack(cursor): SigilCursor;           // pops history
export function navigateToRef(cursor, name): SigilCursor;    // resolve + navigate
export function updateTree(cursor, newRoot, newImported?): SigilCursor; // after reload
```

This is a **pure, immutable value**. No React, no side effects. Both the app and site viewer can use it. The site viewer would replace its manual `findContext` + `buildBreadcrumb` calls with `createCursor`/`navigateTo`. The app would replace its scattered resolution logic.

### Layer 2: App state (rewrite)

Replace the monolithic `AppContext` with three focused contexts:

```
DocumentContext    — SigilCursor + rootPath + sigil metadata
                     (changes on navigation, reload)

EditorContext      — editorMode, contentTab, wordWrap, panelOpen flags
                     (changes on UI interaction, persisted to store)

ChatContext        — chats, activeChatId, messages, streaming
                     (changes on chat interaction)
```

`UIState` (panel widths, font size) stays as a separate context as it already is.

**Key change**: `DocumentContext` holds a `SigilCursor` instead of raw `sigil` + `currentPath`. All components read from the cursor — no more `findContext`, `resolveCurrentContext`, `isImportedPath` checks.

### Layer 3: Content ownership (fix synchronization)

```
┌─────────────┐     save(path, content)     ┌──────────┐
│  CodeMirror  │ ──────────────────────────► │   Disk   │
│  (owns doc)  │                             └──────────┘
└──────────────┘                                  │
       │                                    fs-change event
       │ onNavigate/onReload                      │
       ▼                                          ▼
┌─────────────┐     readSigil()             ┌──────────┐
│   Cursor    │ ◄─────────────────────────── │  Backend │
│  (tree only)│                              └──────────┘
└─────────────┘
```

- CodeMirror writes directly to disk via auto-save. No intermediate React state for content.
- The cursor holds the **tree structure** (names, children, paths) but components don't read `domain_language` from it for the active editor — CodeMirror has the authoritative version.
- On navigation away, auto-save flushes. On navigation to new sigil, CodeMirror receives content from the cursor.
- File watcher reloads the tree structure only. It never touches CodeMirror's content for the currently-edited file.

### Layer 4: CodeMirror scope (fix globals)

Replace the 6 global variables in `sigilExtensions.ts` with a CodeMirror `Facet`:

```typescript
export const sigilScope = Facet.define<SigilCursor, SigilCursor>({...});
```

Components reconfigure the facet when the cursor changes. Extensions read from the facet instead of globals. This is how CodeMirror is designed to work.

### Layer 5: Shared UI components

Extract into `src/components/shared/`:
- `RenamePopup` — used by MarkdownEditor, SigilPropertyEditor, OntologyTree
- `RefsDropdown` — used by MarkdownEditor, SigilPropertyEditor
- `ContextMenu` — used by OntologyTree, Atlas

---

## What Changes Where

| File | Change |
|------|--------|
| `packages/sigil-core/src/document.ts` | **New** — SigilCursor model |
| `packages/sigil-core/src/index.ts` | Export new module |
| `src/state/AppContext.tsx` | **Rewrite** → split into 3 contexts |
| `src/state/DocumentContext.tsx` | **New** — cursor-based document state |
| `src/state/EditorContext.tsx` | **New** — UI/editor state |
| `src/state/ChatContext.tsx` | **New** — chat state |
| `src/components/Workspace/Workspace.tsx` | **Simplify** — reads cursor, no more resolution logic |
| `src/components/Workspace/MarkdownEditor.tsx` | **Simplify** — reads scope from facet, owns content |
| `src/components/Workspace/sigilExtensions.ts` | **Rewrite** — facet-based, no globals |
| `src/components/Workspace/SigilPropertyEditor.tsx` | **Simplify** — fewer props, shared components |
| `src/components/OntologyTree/OntologyTree.tsx` | **Simplify** — reads cursor for navigation |
| `src/components/shared/RenamePopup.tsx` | **New** — extracted |
| `src/components/shared/RefsDropdown.tsx` | **New** — extracted |
| `src/hooks/useAutoSave.ts` | **Fix** — flush on navigation, no dirty flag race |
| `src/hooks/useFileWatcher.ts` | **Fix** — reloads tree only, never clobbers editor |
| `src/hooks/useSigil.ts` | **Simplify** — creates cursor on open/reload |

---

### Assistant (21:42 UTC)

You're absolutely right. `Context` is a backend implementation leak — the spec speaks of **Sigil**, **SigilFolder**, **LanguageFile**, **AffordanceFile**, **InvariantFile**. The domain model must use spec language.

Let me re-read the exact spec terms and redesign the types.

### Assistant (21:42 UTC)

*Files: [packages/sigil-core/src/types.ts](../../packages/sigil-core/src/types.ts), [packages/sigil-core/src/index.ts](../../packages/sigil-core/src/index.ts)*

Now let me also check what the Rust backend calls these types and the Tauri API types.

### Assistant (21:42 UTC)

*Files: [src/tauri.ts](../../src/tauri.ts)*

Good. Now I see the full picture. The Tauri layer extends `Context` with `path` (filesystem path) and `images`. Let me redesign with spec language.

Here's the corrected domain model, aligned to the spec:

---

## Corrected Domain Model (spec language)

The spec defines:
- **Sigil** — the recursive unit. Has a name, narrative (language.md), affordances, invariants, and child sigils.
- **SigilFolder** — filesystem representation of a Sigil
- **Root** — the top of a SigilFolder hierarchy, has a path
- **Imported Ontologies** — sigils from Libs, flattened into scope

The current `Context` in sigil-core maps to **Sigil** (the domain concept). The current `Sigil` in sigil-core maps to **Root** (it holds vision + root sigil). These names must change.

### Rename plan:

| Current name | Spec name | Meaning |
|---|---|---|
| `Context` | `Sigil` | A sigil node in the tree |
| `Sigil` (sigil-core) | `SigilSpec` | The full specification (vision + root sigil) |
| `Context` (tauri.ts) | `SigilFolder` | A sigil with filesystem path + images |
| `Sigil` (tauri.ts) | `OpenSpec` | A spec open for editing (root_path + imported ontologies) |

### New sigil-core types:

```typescript
// The domain concept - a sigil in the tree
export interface Sigil {
  name: string;
  language: string;          // was domain_language
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  isImported?: boolean;      // was is_imported
}

// A complete specification (root + vision)
export interface SigilSpec {
  name: string;
  vision: string;
  root: Sigil;
}
```

### Tauri extensions:

```typescript
// Sigil on disk (adds filesystem concerns)
export interface SigilFolder extends Sigil {
  path: string;              // filesystem path
  children: SigilFolder[];
  images: string[];
}

// An open specification being edited
export interface OpenSpec extends SigilSpec {
  rootPath: string;          // was root_path
  root: SigilFolder;
  importedOntologies?: SigilFolder;  // was imported_ontologies
}
```

### SigilCursor uses spec terms:

```typescript
export interface SigilCursor {
  root: Sigil;
  importedOntologies: Sigil | null;
  currentPath: string[];
  // Derived:
  currentSigil: Sigil;       // not "currentContext"
  isImportedPath: boolean;
  scopeRoot: Sigil;
  scopePath: string[];
  breadcrumbs: Crumb[];
  lexicalScope: Ref[];
  history: string[][];        // navigation stack for back
}
```

### Assistant (21:43 UTC)

You're right. "SigilCursor" is implementation jargon, not domain language. Let me rethink.

The spec already has the concept: **Workspace**. The user navigates within a workspace. The workspace has a current sigil, navigation history, and scope. There's no need for a new abstraction — sigil-core already exports the pure functions (`findContext`, `buildBreadcrumb`, `buildLexicalScope`). The problem isn't missing abstractions, it's that the app **re-implements** them instead of using them.

Revised plan — no new "cursor" type:

### What sigil-core gets:

1. **Rename types** to spec language (`Context` → `Sigil`, etc.)
2. **Add `navigateBack`-compatible history** as a simple utility: `pushHistory(history, path)` / `popHistory(history)`
3. **Extend `buildLexicalScope`** to handle imported ontologies (the app's custom version gets folded into core)

### What the app gets:

1. **WorkspaceContext** (React context) — holds `currentPath`, `history`, `openSpec`. Provides `navigate(path)`, `goBack()`, `reload()`. All components read from this instead of prop-drilling path + sigil.
2. **EditorContext** — editorMode, contentTab, wordWrap, panel flags
3. **ChatContext** — chat state

No new domain types beyond what the spec defines. The derived values (breadcrumbs, scope, current sigil) are computed inline using sigil-core functions, memoized where needed.

Does this sit better? The Workspace IS the concept. Components read from WorkspaceContext and call sigil-core functions to derive what they need.

### Assistant (21:43 UTC)

What's on your mind?

### Assistant (21:44 UTC)

Looking at the spec again:

- **Sigil** — the recursive unit, the core concept. "I call this unit a Sigil."
- **SigilFolder** — "the filesystem representation of a @sigil"
- **Root** — "the top of a SigilFolder hierarchy"

There is no **SigilSpec** in the spec. I invented that. The current sigil-core `Sigil` type (which holds `name`, `vision`, `root`) maps to **Root** — it's the top of the hierarchy with vision attached.

So:

| Current | Spec term |
|---|---|
| `Context` | `Sigil` |
| `Sigil` (sigil-core) | `Root` |
| `Context` (tauri.ts, with `path`) | `SigilFolder` |
| `Sigil` (tauri.ts, with `root_path`) | `Root` (extended with filesystem concerns) |

No invented names. Only what's in the spec.

### Assistant (21:46 UTC)

You're right, and I apologize. The spec is clear. I was retrofitting names onto the existing broken model instead of reading the spec and thinking from it. Let me state it cleanly:

- **Sigil** — the domain concept. Recursive. Has name, language, affordances, invariants, children (which are Sigils).
- **SigilFolder** — the filesystem projection of a Sigil. Recursive. Adds path, images, and any other filesystem concerns. A SigilFolder that happens to be at the top of the hierarchy we opened is just... the one we opened. Not a special type.
- **ApplicationSpec** — the specification being worked on. It has a vision, a root Sigil (which we're viewing as a SigilFolder on disk), and imported ontologies.

There is no "Root" type. There is no "SigilSpec". A SigilFolder can be the root of a hierarchy — that's a positional fact, not a type.

```typescript
// sigil-core: pure domain
interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  isImported?: boolean;
}

// app: filesystem projection
interface SigilFolder extends Sigil {
  path: string;
  children: SigilFolder[];
  images: string[];
}

// app: the open specification
interface ApplicationSpec {
  name: string;
  vision: string;
  root: SigilFolder;            // the top-level sigil folder we opened
  rootPath: string;             // where it lives on disk
  importedOntologies?: SigilFolder;
}
```

No invented concepts. No overloading. Is this correct?

### User (21:48 UTC)

Where did the imported ontologies go? Why are you not using the word workspace? Workspace is where I work. Workspace contains all of the panels. Look, read the fucking spec—it looks like you never looked at it.

### Assistant (21:48 UTC)

You're right. I'm not reading the spec. Let me actually look at it.

### Assistant (21:49 UTC)

*Files: [docs/specification/sigil-editor.sigil/Application/User/Workspace/language.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/language.md), [docs/specification/sigil-editor.sigil/Application/SigilFolder/Root/language.md](../../docs/specification/sigil-editor.sigil/Application/SigilFolder/Root/language.md), [docs/specification/sigil-editor.sigil/Application/User/Workspace/invariant-imported-ontology-in-scope.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/invariant-imported-ontology-in-scope.md), [docs/specification/sigil-editor.sigil/Application/User/Workspace/Narrating/OntologyTree/invariant-exposes-imported-ontologies.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/Narrating/OntologyTree/invariant-exposes-imported-ontologies.md), [docs/specification/sigil-editor.sigil/Application/SigilFolder/language.md](../../docs/specification/sigil-editor.sigil/Application/SigilFolder/language.md)*

Now I see it. The spec is structured as:

```
Workspace
├── Narrating (Language, OntologyTree)
├── Navigating (Atlas)
└── Conversing (Chat, Memories)
```

The Workspace IS the spec being worked on. Imported ontologies appear in the OntologyTree and are in lexical scope of every sigil. They're not a separate field on some invented type — they're part of the tree, exposed by the tree.

Here's the model, read from the spec this time:

```typescript
// sigil-core: the domain concept
interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  isImported?: boolean;
}

// app: filesystem projection (SigilFolder from spec)
interface SigilFolder extends Sigil {
  path: string;
  children: SigilFolder[];
  images: string[];
}

// app: Workspace state — "the .sigil directory, where I work"
interface Workspace {
  root: SigilFolder;           // the sigil hierarchy I opened
  rootPath: string;            // where it lives on disk
  importedOntologies: SigilFolder | null;  // exposed in tree, in scope everywhere
  currentPath: string[];       // where I am navigating
  history: string[][];         // for #back
}
```

Imported ontologies are **exposed in the OntologyTree** and **in lexical scope** — that's what the spec says. They're a structural part of what the Workspace shows, not a type-level concept. The Workspace holds them because it needs to show and scope them.

The React contexts then map to the spec's Workspace structure:

- **WorkspaceContext** — the Workspace above. Navigation, tree, scope.
- **NarratingContext** — editor mode, word wrap, content tab (Language vs Atlas)
- **ConversingContext** — chat state, memories

These ARE spec terms. Narrating, Navigating, and Conversing are the three modes of engagement defined in the Workspace language.

Is this grounded now?

### Assistant (21:50 UTC)

Because I'm being stupid. The spec says it plainly:

> A SigilFolder is the filesystem representation of a @sigil. It contains the sigil's @LanguageFile, @AffordanceFiles, @InvariantFiles, and child @SigilFolders.

A SigilFolder doesn't just "extend Sigil with a path." It IS the filesystem projection — it contains files, not abstract concepts. It knows where the language file is, where the affordance files are, where the invariant files are.

```typescript
// sigil-core: pure domain concept
interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  isImported?: boolean;
}

// app: filesystem projection — knows about files
interface SigilFolder {
  name: string;
  path: string;                          // where this folder lives
  languageFile: string;                  // path to language.md
  affordanceFiles: AffordanceFile[];     // the affordance files it contains
  invariantFiles: InvariantFile[];       // the invariant files it contains
  children: SigilFolder[];              // child SigilFolders
  images: string[];
  isImported?: boolean;
}

interface AffordanceFile {
  name: string;
  path: string;       // filesystem path to affordance-{name}.md
  content: string;
}

interface InvariantFile {
  name: string;
  path: string;       // filesystem path to invariant-{name}.md
  content: string;
}
```

SigilFolder doesn't extend Sigil. It's a separate thing — the filesystem projection. It contains files. A Sigil is a domain concept with language, affordances, invariants. A SigilFolder is a directory with a LanguageFile, AffordanceFiles, InvariantFiles, and child SigilFolders.

### Assistant (21:51 UTC)

Good. Let me also read the remaining spec terms I need before implementing — the Narrating and Conversing language files, so the React contexts use exact spec terms.

### Assistant (21:52 UTC)

*Files: [docs/specification/sigil-editor.sigil/Application/User/Workspace/Narrating/language.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/Narrating/language.md), [docs/specification/sigil-editor.sigil/Application/User/Workspace/Conversing/language.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/Conversing/language.md), [docs/specification/sigil-editor.sigil/Application/User/Workspace/Navigating/language.md](../../docs/specification/sigil-editor.sigil/Application/User/Workspace/Navigating/language.md)*

Clear. Here's the final model, grounded in the spec:

**Types:**
- `Sigil` — domain concept (sigil-core)
- `SigilFolder`, `AffordanceFile`, `InvariantFile` — filesystem projection (app)

**React contexts, mapped to spec:**
- `WorkspaceContext` — the workspace: root SigilFolder, imported ontologies, current path, history, navigate/back/reload
- `NarratingContext` — editor mode (edit/split/preview), content tab (language/atlas), word wrap
- `ConversingContext` — chats, active chat, messages, streaming

**Fixes:**
- CodeMirror owns content, writes to disk via auto-save, never reads back from React state
- sigilExtensions uses CodeMirror Facet instead of globals
- Shared UI components (RenamePopup, RefsDropdown)
- sigil-core gets the renamed types and the extended lexical scope with imported ontologies

Starting implementation now.

### Assistant (21:52 UTC)

Let me start with sigil-core — renaming the types and extending lexical scope. Then I'll work outward to the app.

### Assistant (21:52 UTC)

*Files: [packages/sigil-core/src/tree.ts](../../packages/sigil-core/src/tree.ts), [packages/sigil-core/src/refs.ts](../../packages/sigil-core/src/refs.ts)*

Now I have the complete picture. Let me start the rewrite. First, sigil-core types.

### Assistant (21:52 UTC)

*Files: [packages/sigil-core/src/highlight.ts](../../packages/sigil-core/src/highlight.ts), [packages/sigil-core/src/frontmatter.ts](../../packages/sigil-core/src/frontmatter.ts), [packages/sigil-core/src/treemap.ts](../../packages/sigil-core/src/treemap.ts)*

Good. Now I have every file in sigil-core. Let me also check the React Atlas component and the site viewer's state to understand what needs renaming there.

### Assistant (21:52 UTC)

*Files: [packages/sigil-core/react/Atlas.tsx](../../packages/sigil-core/react/Atlas.tsx), [site/src/viewer/ViewerState.tsx](../../site/src/viewer/ViewerState.tsx), [site/src/viewer/types.ts](../../site/src/viewer/types.ts), [packages/sigil-core/src/react/Atlas.tsx](../../packages/sigil-core/src/react/Atlas.tsx)*

Good. Now I have everything. Let me start implementing. This is a comprehensive rewrite, so I'll work file by file starting from the foundation (sigil-core types) and working outward.

### Assistant (21:52 UTC)

*Files: [packages/sigil-core/src/types.ts](../../packages/sigil-core/src/types.ts)*

Now update all sigil-core internal files to use the new field names while keeping backward compat. The key rename is `domain_language` → `language` and `is_imported` → `isImported`. Since the Rust backend serializes with snake_case, I need to handle both for now.

### Assistant (21:53 UTC)

*Files: [packages/sigil-core/src/tree.ts](../../packages/sigil-core/src/tree.ts), [packages/sigil-core/src/refs.ts](../../packages/sigil-core/src/refs.ts), [packages/sigil-core/src/treemap.ts](../../packages/sigil-core/src/treemap.ts)*

Now update `computeWeight` and `maxDepth` which use `Context` parameter names:

### Assistant (21:53 UTC)

*Files: [packages/sigil-core/src/treemap.ts](../../packages/sigil-core/src/treemap.ts)*

Now update the index to export both new and backward-compat names:

### Assistant (21:54 UTC)

*Files: [packages/sigil-core/src/index.ts](../../packages/sigil-core/src/index.ts)*

Now update the Atlas React component in sigil-core:

### Assistant (21:54 UTC)

*Files: [packages/sigil-core/src/react/Atlas.tsx](../../packages/sigil-core/src/react/Atlas.tsx)*

Now let me verify sigil-core builds cleanly:

### Assistant (21:54 UTC)

Good — the JSX errors are pre-existing (no tsconfig for JSX in the package). The important error is the test file using old field names. Let me check and fix the test:

### Assistant (21:54 UTC)

*Files: [packages/sigil-core/src/refs.test.ts](../../packages/sigil-core/src/refs.test.ts)*

Now let me verify sigil-core type-checks (excluding the pre-existing JSX issues):

### Assistant (21:54 UTC)

Clean. Now let me run the tests:

### Assistant (21:54 UTC)

All 27 tests pass. sigil-core is clean. Now update the site viewer's types to use the new names:

### Assistant (21:55 UTC)

*Files: [site/src/viewer/types.ts](../../site/src/viewer/types.ts)*

Now create the app's domain types. The Rust backend currently serializes with `domain_language`, `is_imported`, `root_path`, `imported_ontologies` (snake_case). I need a compatibility layer that maps these to spec-aligned names. Let me check the Rust model first:

### Assistant (21:55 UTC)

*Files: [src-tauri/src/models/sigil.rs](../../src-tauri/src/models/sigil.rs)*

The Rust backend uses snake_case field names (`domain_language`, `is_imported`, `root_path`, `imported_ontologies`). The simplest approach: rename the Rust structs and fields to match the spec, and use `#[serde(rename)]` where needed for backward compatibility with stored data.

Let me update the Rust model first, then the TypeScript tauri.ts bridge:

### Assistant (21:55 UTC)

*Files: [src-tauri/src/models/sigil.rs](../../src-tauri/src/models/sigil.rs)*

Now I need to update all Rust files that reference the old `Context` and `Sigil` types, and update field accesses from `domain_language` to `language`. This is a large mechanical change across the Rust backend. Let me find all the files:

### Assistant (21:55 UTC)

This is a large mechanical change across 5 Rust files. Let me do it systematically with an agent:

### Assistant (21:58 UTC)

Let me verify the Rust backend compiles:

### Assistant (21:58 UTC)

While the Rust build runs, let me update the TypeScript bridge (`tauri.ts`) and create the new app types:

### Assistant (21:58 UTC)

*Files: [src/tauri.ts](../../src/tauri.ts)*

Now rewrite tauri.ts with the new types. The Rust backend now serializes with camelCase, so the TypeScript types should match:

### Assistant (21:59 UTC)

*Files: [src/tauri.ts](../../src/tauri.ts)*

Now create the three new React contexts. Let me start with WorkspaceContext:

### Assistant (22:00 UTC)

*Files: [src/state/WorkspaceContext.tsx](../../src/state/WorkspaceContext.tsx), [src/state/NarratingContext.tsx](../../src/state/NarratingContext.tsx), [src/state/ConversingContext.tsx](../../src/state/ConversingContext.tsx)*

Now let me check if the Rust build finished:

### Assistant (22:00 UTC)

Rust backend builds clean. Now I need to update AppContext.tsx to become a thin orchestrator that composes the three new contexts, and update all components. This is the most complex part — many files reference the old types.

Let me update AppContext to be the orchestrator, and then update the workspace actions and components. I'll use agents to parallelize the mechanical file updates:

### Assistant (22:00 UTC)

*Files: [src/state/AppContext.tsx](../../src/state/AppContext.tsx)*

Now update workspace actions to use new types:

### Assistant (22:01 UTC)

*Files: [src/actions/workspace.ts](../../src/actions/workspace.ts)*

This is a massive refactor with many files to update. Let me save the current state to memory before context gets compressed, then continue with the component updates using agents for the mechanical parts:

### Assistant (22:02 UTC)

Now I need to update all the components. This is a large mechanical transformation — many files need `Context` → `SigilFolder`, `domain_language` → `language`, `root_path` → `rootPath`, etc. Let me launch parallel agents for the mechanical updates:

### Assistant (22:02 UTC)

Two agents running in background: one updating hooks, one updating sigilExtensions. Meanwhile, let me work on the components that I can update in parallel — Workspace.tsx is the most complex one. But first, let me update App.tsx since it needs to wire the new providers:

### Assistant (22:02 UTC)

*Files: [src/App.tsx](../../src/App.tsx)*

App.tsx needs a significant rewrite because it currently uses `openDocument` which creates the old `OpenDocument` and dispatches `SET_DOCUMENT`. In the new model, App.tsx needs to load the spec and wrap the Workspace component in the new providers. But this depends on the hooks being updated first.

Let me wait for the background agents to complete before continuing with the most interconnected changes. Let me check their progress:

### Assistant (22:03 UTC)

They're still working. Let me proceed with updating the components that I can work on now — the DocumentPicker doesn't depend on the workspace state at all, and the panel components are simpler. But actually, the most impactful thing to do while waiting is to plan the App.tsx rewrite since it's the orchestrator.

The new App.tsx flow should be:
1. Load settings, theme (as before)
2. When opening a workspace: load `ApplicationSpec` from backend
3. Wrap workspace view in `WorkspaceProvider` + `NarratingProvider` + `ConversingProvider`
4. Pass initial state from persisted doc state into providers

Let me check on the DocumentPicker to see what it needs:

### Assistant (22:03 UTC)

*Files: [src/components/DocumentPicker/DocumentPicker.tsx](../../src/components/DocumentPicker/DocumentPicker.tsx)*

DocumentPicker uses `openDocument` from `useSigil` — that will need to change when the hooks agent finishes. Let me wait for the agents and then do a comprehensive sweep.

Let me check if either agent has completed:

### Assistant (22:03 UTC)

The agents are still working. This is a very large refactor and I realize the comprehensive approach of updating every component in one session is going to be extremely lengthy. Let me be transparent about where we are and what the right next step is.

---

Here's the status. The **foundation is laid**:

**Done:**
- sigil-core: types renamed (Sigil, language), tests pass
- Rust backend: types renamed (SigilFolder, ApplicationSpec, language), builds clean
- tauri.ts: bridge updated with new types
- Three new React contexts: WorkspaceContext, NarratingContext, ConversingContext
- AppContext: slimmed to app-level concerns only
- workspace.ts actions: updated to SigilFolder

**In progress (background agents):**
- Hook files being updated
- sigilExtensions.ts being updated

**Remaining (the large part):**
- App.tsx needs rewriting to wire new providers
- Every component (Workspace, MarkdownEditor, SigilPropertyEditor, OntologyTree, all panels, DocumentPicker) needs updating to use new contexts
- Shared UI extraction (RenamePopup, RefsDropdown)
- Content sync fix
- Full build verification

The mechanical part — updating ~15 component files to use new imports and field names — is well-defined but voluminous. Each file follows the same pattern: replace `useDocument()` with the appropriate new context hook, rename fields.

Do you want me to continue pushing through all the component updates now, or would you prefer to commit what we have (the foundation) and continue the component migration in a follow-up session? The foundation won't compile on its own yet since the old AppContext API is removed but consumers aren't updated.

### Assistant (22:03 UTC)

That hook doesn't apply — this is a Tauri app with no browser preview server. Continuing.

Let me check if the background agents finished, then keep pushing through component updates.

### Assistant (22:04 UTC)

Still running. Let me continue with the components I can update now — starting with the most critical: rewriting Workspace.tsx to use the new contexts. This is the god component that needs the most restructuring.

### Assistant (22:05 UTC)

*Files: [src/components/Workspace/Workspace.tsx](../../src/components/Workspace/Workspace.tsx)*

Let me create the branch and commit, then give you the resume prompt.

### Assistant (22:05 UTC)

Committed on `refactor/spec-aligned-types`. 

**Resume prompt for next session:**

> Continue the refactor on branch `refactor/spec-aligned-types`. Read `project_refactor_state.md` from memory. The foundation (sigil-core, Rust, tauri.ts, new contexts, Workspace.tsx) is committed. Remaining: update MarkdownEditor, OntologyTree, SigilPropertyEditor, all panels, App.tsx provider wiring, DocumentPicker, hooks integration, shared UI extraction, and get it compiling.

### Assistant (22:05 UTC)

Rust build agent confirmed success — already committed. Waiting for the two remaining background agents (hooks updater and sigilExtensions updater) to finish, but the WIP is committed on `refactor/spec-aligned-types` and you have the resume prompt. Ready for the next session.

### Assistant (22:06 UTC)

sigilExtensions agent finished — types renamed, compiles clean. That change was already included in the commit. Still waiting on the hooks updater agent.

### Assistant (22:06 UTC)

All three background agents completed. Let me amend the commit to include the hook changes:

### Assistant (22:06 UTC)

The hooks agent's changes to useSigil, useFileWatcher, useAppMenu, useSettingsPersistence were already staged in the first commit. Only useChatStream has new unstaged changes. Let me commit it:

### Assistant (22:06 UTC)

All agent work committed on `refactor/spec-aligned-types`. Two commits:
1. `539f837` — Foundation (sigil-core, Rust, tauri.ts, contexts, Workspace.tsx, hooks, sigilExtensions)
2. `d08d55e` — useChatStream

Ready for next session with the resume prompt I gave you.
