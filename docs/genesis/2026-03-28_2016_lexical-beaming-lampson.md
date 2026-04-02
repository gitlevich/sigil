# Session: lexical-beaming-lampson
**Date**: 2026-03-28 20:16 UTC  
**Source**: Claude  
**Session ID**: `508200ed-64b1-4c06-9ca6-3b5d5a6bb751`

---

### Assistant (20:18 UTC)

Fair point. Let me think about this with you before jumping to implementation.

What you're describing is essentially a **fractal specification tool** — a recursive, bounded-context editor where:

1. **Each context is a box** with a name and a markdown spec (ubiquitous language definition)
2. **Max 5 sub-contexts per context** — a hard cognitive constraint
3. **Navigation is zoom-based** — double-click enters a sub-context, filling the screen
4. **The root context is the application itself**
5. **Nouns in the spec text become candidates for sub-contexts** — the language defines the structure

A few things I want to understand better:

**On the spec text itself:**
- When you write the ubiquitous language at a level, do you envision it as free-form markdown, or something more structured (e.g., a glossary section, behavioral rules, constraints)?
- Is the spec text *only* visible when you're inside that context, or should it be visible as a summary when viewing from the parent?

**On the boxes within a context:**
- When you're viewing a context and its 5 (max) sub-boxes, should they have fixed layout positions or free-form placement?
- Should there be any visual indication of "depth" — i.e., that a sub-box itself contains further sub-boxes?

**On navigation:**
- When you've zoomed into a sub-context, how do you go back up? A breadcrumb trail? A back button? Escape key?
- Should you be able to see the full path (e.g., `App > Auth > TokenManager`) at all times?

### Assistant (20:18 UTC)

Stopping. What would you like to discuss?

### Assistant (20:19 UTC)

Got it. You want to talk through the design. I'm listening.

From what you've described so far: a recursive, zoom-based spec editor where each level defines ubiquitous language for a bounded context, max 5 sub-contexts per level, markdown for the spec text, and double-click to drill down. The nouns you define at one level become the sub-boxes at that level.

What aspect do you want to dig into first?

### Assistant (20:23 UTC)

You're right, I jumped to "zoom" too quickly. Let me describe what I actually understand.

You have a box on screen — the root context, your application. Inside it, you can add smaller boxes, up to 5. Each box has a name. When you double-click one of those inner boxes, it **replaces the current view** — it fills the screen and now *it* is the context you're working in. You're not zooming into a canvas. You're **entering** a context, like navigating into a folder. The previous context is gone from view. You're now *inside* that box, and you can do the same thing again: write its spec, add up to 5 sub-boxes, double-click to enter one of those.

So the interaction model is closer to **navigation** than zooming. There's no spatial relationship being preserved across levels — when you enter a sub-context, you're in a fresh workspace for that context.

At each level, you see:
- The name of the context you're in
- A place to write/edit the spec text in markdown
- The sub-boxes (up to 5) that represent the sub-contexts

The spec text at each level defines the ubiquitous language for that bounded context. The nouns in that language are the things you'd naturally create sub-boxes for — giving them their own name, their own spec, their own sub-contexts.

What I'm less clear on:

1. **How do you go back up?** Some kind of breadcrumb or back button — what feels right to you?
2. **Layout within a context** — when you're inside a context and you see the spec editor plus up to 5 sub-boxes, how should those relate spatially? Spec on top, boxes below? Side by side? Does it matter to you yet?
3. **Creating a sub-box** — what's the gesture? A button that says "add sub-context"? Do you name it immediately?
4. **Editing the name** — can you rename a box after creating it?
5. **Deleting a sub-box** — can you remove one? What happens to its children?

Tell me where I'm wrong and what matters most to clarify.

### Assistant (20:25 UTC)

Clear. Let me play it back.

The screen is always showing exactly one spec. A spec has:

- A **name** (the feature/context it represents)
- A **body** — markdown text where you define what this thing is, why it exists, what it does, at this level of abstraction
- Up to **5 sub-specs** — shown as named boxes within the current view

The workflow:

1. You create a new document. That's the root spec. You name it (your application name). You write its body — the reason it exists, the high-level features. This is the ubiquitous language at the top level.
2. For each feature you've identified (up to 5), you add a sub-spec box. You give it a name right there.
3. When you're ready to flesh one out, you double-click it. The screen now *is* that spec. Same structure: name, body, up to 5 sub-specs.
4. You keep going — depth-first, breadth-first, however you think — until you've specified enough detail to implement.

To go back up, you need some way to return to the parent. I'd say a breadcrumb trail showing the path — like `MyApp > Auth > TokenManager` — where each segment is clickable to jump back to that level. This also tells you where you are in the hierarchy at all times.

Things I want to nail down:

**The sub-spec boxes within a view** — you said you "add them" and "name them." So the interaction is: you click something like an "add" button, a new small box appears, you type its name. These boxes are just labeled rectangles sitting below or alongside the spec body. You can't edit their body text from the parent — you have to enter them. Correct?

**Deletion** — can you remove a sub-spec? If so, does it take its entire subtree with it?

**Reordering** — does the order of the sub-spec boxes matter, or are they unordered?

**Persistence** — this is a document. You save it, you open it later, you pick up where you left off. One file per spec tree, or does that not matter yet?

### Assistant (20:34 UTC)

Good. The folder structure is elegant — the file system mirrors the spec tree directly.

So a spec called "MyApp" with sub-specs "Auth" and "Billing" looks like:

```
MyApp/
  spec.md
  Auth/
    spec.md
    TokenManager/
      spec.md
    SessionStore/
      spec.md
  Billing/
    spec.md
```

Each folder is a context. Each `spec.md` is the body text at that level. The folder name is the spec name. No metadata files needed — the structure *is* the metadata.

Creating a sub-spec means creating a subfolder with an empty `spec.md`. Deleting a sub-spec means deleting the subfolder and everything in it. Renaming means renaming the folder.

For document management: you need a way to pick where these root folders live on disk. So the app has a notion of "open document" which is just pointing at a root folder. You can:

- **Create new** — pick a location, name it, creates the root folder with an empty `spec.md`
- **Open existing** — browse to a root spec folder
- **Open recent** — the app remembers the last few root folders you've worked with
- **Close** — returns you to this document picker

A few things to confirm:

**The spec body** — is it literally just the content of `spec.md`? No frontmatter, no structured fields beyond the markdown itself? The name comes purely from the folder name?

**The "add sub-spec" action** — you type a name, and that creates a subfolder on disk immediately? Or is there a save step?

**Concurrent editing** — this is a single-user tool, right? Just you working on one document at a time?

### Assistant (20:36 UTC)

So the markdown editor has three view modes, like IntelliJ's markdown plugin:

- **Edit only** — just the markdown source
- **Split** — editor on one side, rendered preview on the other
- **Preview only** — full rendered markdown

And you can switch between these freely while working on any spec.

Multiple specs open simultaneously — so the app has something like tabs or a sidebar listing open documents. You can switch between different root spec trees without closing one to open another.

Let me also clarify what the screen looks like when you're inside a spec. From top to bottom (or however it's laid out):

- **Breadcrumb** — shows path like `MyApp > Auth > TokenManager`, each segment clickable
- **Spec name** — the name of the current context (editable, since renaming is supported)
- **Markdown editor** — the body of this spec, with the three view modes
- **Sub-spec boxes** — up to 5 named boxes, with an "add" button if fewer than 5 exist

The sub-spec boxes area is always visible below the editor. When there are no sub-specs yet, it's just an add button. When there are 1-5, you see those boxes plus the add button (until you hit 5).

Questions:

**Tabs** — when you have multiple root specs open, is it just tabs at the very top of the window? Or do you envision something else?

**Proportions** — the markdown editor and the sub-spec boxes share the screen. Should the sub-spec boxes be a compact strip at the bottom, or should they take significant space? I ask because if you have a long spec, you'd want most of the space for writing, and the boxes are just navigation targets.

**Keyboard shortcuts** — do you care about things like Escape to go back up a level, or is mouse-only fine for now?

### Assistant (20:38 UTC)

Interesting. So while you're inside a spec at any level, you can invoke an AI agent to review what you've written. The agent would see the spec body and presumably needs context — at minimum the current spec, possibly the parent chain or the whole tree.

Let me think about what "review" means here:

- The agent reads the spec (or the relevant portion of the tree)
- It gives you feedback — maybe about clarity, completeness, consistency of the ubiquitous language, whether nouns in the body text are missing corresponding sub-specs, whether the decomposition makes sense
- The feedback appears somewhere in the UI — a side panel, a chat-like area, inline comments?

Things to pin down:

**Scope of what the agent sees** — when you ask for a review at a given level, does the agent see:
- Just the current spec body?
- The current spec plus its immediate sub-spec names?
- The entire subtree from this node down?
- The path from root to here (ancestor chain) for context?

**How feedback is presented** — a chat conversation on the side? A one-shot review that appears as a block of text? Can you have a back-and-forth with the agent, or is it a single "review this" action?

**API configuration** — you need somewhere to enter your API key and choose the provider (Anthropic or OpenAI). A settings screen? And do you pick a specific model, or just the provider?

**The prompt** — is the review prompt fixed ("review this spec for clarity and completeness") or can you type a custom prompt each time, like "does this decomposition make sense" or "am I missing a key feature"?

### Assistant (20:43 UTC)

Good. So let me update the full picture.

A spec at each level now has three things:

- **Name** — from the folder name
- **Body** — the ubiquitous language, the what and why, in markdown
- **Technical notes** — implementation concerns, constraints, architectural decisions, also in markdown

The technical notes are separate from the body because they serve a different purpose. The body is about *what* and *why* at this abstraction level. The technical notes are about *how* — things like "this must use WebSockets" or "latency budget is 50ms" or "must work offline." They inherit downward: if a child spec has no technical notes, the parent's apply. You only add them when there's something specific to say at that level.

On disk, that means each folder has:

```
Auth/
  spec.md
  notes.md
  TokenManager/
    spec.md
```

TokenManager has no `notes.md` — so Auth's notes apply. If TokenManager had its own, they'd be specific to that level.

For the AI chat:

- A side panel with a conversation interface
- The agent's context is the **entire spec tree** — all names, bodies, and technical notes, structured to reflect the hierarchy
- A system prompt that explains what this document is: a recursive hierarchical specification defining bounded contexts with ubiquitous language at each level, plus technical notes that inherit downward. The agent's job is to review for coherence and completeness toward implementation readiness.
- The system prompt is editable in settings alongside the API key and model selection
- You type messages and have a back-and-forth conversation, just like this one

**One question**: the AI conversation — is it per spec tree (one conversation for the whole document) or per session (resets when you close the app)? Should the conversation history persist on disk alongside the spec?

### Assistant (20:48 UTC)

Right. So `notes.md` is the wrong name. It's `technical.md` or even just the file name should make clear what it is. These are **technical decisions** — architecture choices, technology stack, design patterns, constraints. Not general notes.

And they sit alongside the spec body as a distinct concern. The spec body says "Auth handles user identity verification and session management." The technical decisions say "Use JWT with RS256, Redis for session storage, tokens expire after 15 minutes."

On disk:

```
Auth/
  spec.md
  technical.md
  TokenManager/
    spec.md
```

In the UI, at each spec level you'd have two editor areas — or tabs, or some way to switch between the spec body and the technical decisions. Both are markdown, both have the three view modes.

The inheritance rule: if `TokenManager` has no `technical.md`, Auth's technical decisions apply to it. This means a top-level `technical.md` saying "use TypeScript, deploy on AWS" cascades to every sub-spec unless overridden.

Back to your question about whether the AI conversation persists — what do you think? Should it be saved with the spec tree so you can revisit what the agent said?

### Assistant (20:48 UTC)

So the conversation persists with the document. On disk, it would live at the root level of the spec tree:

```
MyApp/
  spec.md
  technical.md
  chat.json
  Auth/
    spec.md
    technical.md
    TokenManager/
      spec.md
  Billing/
    spec.md
```

`chat.json` stores the full conversation history — your messages and the agent's responses. When you reopen the document, the chat is still there in the side panel. You can continue where you left off.

I think I have a complete picture now. Let me write the full specification so you can review it. Should I write it as the first spec in this tool's own format — a `spec.md` in this project directory — or just as a standalone document?

### Assistant (21:09 UTC)

Good additions. Let me make sure I have them.

**Vision statement** — a short markdown document at the root level. It captures the purpose, the north star of the application. It's pinnable, meaning you can have it visible at all times regardless of which spec level you're navigated into. So when you're deep inside `TokenManager`, you can still glance at why this whole application exists. On disk it's `vision.md` at the root.

**Export** — flattens the entire spec tree into a single document. The hierarchy is preserved through heading levels or indentation or some structural formatting. This gives you a portable artifact you can hand to someone (or an agent) as one file.

**The implementation workflow you described** — this is important context for why the tool is structured this way. You work leaf-first: pick a leaf spec, implement it in a small, bounded context with an agent. Then the next leaf. Then compose them at the parent level. Move up, maybe back down. One layer of abstraction at a time. The tool's structure directly supports this because each spec is self-contained with its own body and technical decisions, and the inheritance of technical decisions means the agent always knows the constraints.

The export format — I'd assume markdown with the hierarchy expressed through headings. Something like:

```
# MyApp
[vision statement]

[spec body]

## Technical Decisions
[technical.md content]

## Auth
[spec body]

### Technical Decisions
[technical.md content]

### TokenManager
[spec body]
```

Does that shape feel right for the export, or do you want something different?

And the pinned vision — is it a small floating panel? A collapsible strip at the top of the screen? What feels right?

### Assistant (21:15 UTC)

That makes sense. You'd start from the root, implement the top-level structure, then go one level deeper, implement that layer, and so on. Outside-in. The spec tree guides you downward. The vision keeps you aligned so you don't drift.

The pinned vision — I'm thinking a collapsible strip at the top, always accessible. You expand it when you need the reminder, collapse it when you need the screen space. It's there at every level of navigation.

I think I have everything I need. Let me write the full specification. I'll put it in this project directory.

### Assistant (21:16 UTC)

*Files: [-spec.md](../../-spec.md)*

Good point. Let me update the layout — vision strip on the left, AI chat on the right, both collapsible side panels. The main content area is between them.

### Assistant (21:17 UTC)

*Files: [-spec.md](../../-spec.md)*

Now let me also clean up the AI Review Panel section since it's now described in the layout.

### Assistant (21:17 UTC)

*Files: [-spec.md](../../-spec.md)*

Also update the vision strip interaction since it's now a side panel, not a top strip.

### Assistant (21:17 UTC)

*Files: [-spec.md](../../-spec.md)*

And move the tabs from "above the vision strip" to where they belong now:

### Assistant (21:17 UTC)

*Files: [-spec.md](../../-spec.md)*

Updated. The layout is now:

- **Left panel** — collapsible vision statement
- **Center** — tabs, breadcrumb, markdown editor, technical decisions toggle, sub-context bar
- **Right panel** — collapsible AI chat

Both side panels are per-document and collapse to a thin strip. Review the spec at `/Users/vlad/Attention Lab/sigil-specs/sigil-spec.md` and tell me what needs adjustment.

### Assistant (21:27 UTC)

So the left panel has two things: the vision statement at the top, and below it a tree navigator — a collapsible table of contents showing the full spec tree structure. You can expand/collapse branches to see the hierarchy, and clicking any node navigates directly to that context.

This gives you three ways to navigate: the breadcrumb (linear, ancestors only), the sub-context bar (one level down), and the tree view (the whole structure at a glance).

### Assistant (21:27 UTC)

*Files: [-spec.md](../../-spec.md)*

Done. The left panel now has the vision statement pinned at the top with the tree navigator below it. Clicking any node in the tree jumps you there. The current context is highlighted so you always know where you are in the structure.

### Assistant (21:28 UTC)

*Files: [-spec.md](../../-spec.md)*

Done. Two tabs in the left panel — Vision and Tree — switching the full panel between them.

### Assistant (21:29 UTC)

Given the requirements — native file system as source of truth, auto-save, directory watching, markdown editing, AI streaming — this is a desktop app.

**My suggestion: Tauri + React + TypeScript**

Why Tauri over Electron:
- Native file system access through Rust backend — fast directory operations, file watching
- Much smaller binary and memory footprint
- You're building a focused tool, not a browser disguised as an app

Why React:
- Best ecosystem for the components you need. CodeMirror 6 for the markdown editor (same engine as VS Code's editor), mature tree view components, panel layouts
- You'll find solutions for every UI piece without building from scratch

Key libraries:
- **CodeMirror 6** — markdown editing with syntax highlighting
- **markdown-it** or **react-markdown** — rendering the preview
- A tree component for the navigator (or a simple recursive component, the tree is small with the max-5 constraint)
- Streaming fetch for the AI chat (both Anthropic and OpenAI APIs support SSE)

The Rust backend handles:
- All file system operations (read, write, create directory, rename, delete, watch for external changes)
- Serving these as Tauri commands to the React frontend

Alternative would be **Electron** if you want to stay purely in the JS/TS world and avoid Rust. More familiar, more bloated, but it works.

What's your preference?

### Assistant (21:29 UTC)

Good. Let me add the technical decisions to the spec.

### Assistant (21:29 UTC)

*Files: [-spec.md](../../-spec.md)*

Added the full technology section. Tauri 2 + React + TypeScript + CodeMirror 6 + Rust backend for file ops and AI API calls. macOS first.

Anything you want to adjust or add before we call this spec complete?

### Assistant (21:31 UTC)

New session. The spec is self-contained in `/Users/vlad/Attention Lab/sigil-specs/sigil-spec.md` — that's all the context needed. This session was design; the next one should be pure implementation with a full context budget.

Let me save a memory so the next session has the right context.

### Assistant (21:31 UTC)

Start a new session and tell it: "Implement the Sigil app according to the spec in `sigil-spec.md`." Everything it needs is in that file.
