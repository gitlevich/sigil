# Sigil

## Vision

Sigil is a tool for structuring how you think about a system and sharing that structure with AI. A sigil is a tree of bounded contexts, each defining domain language at its level of abstraction. The constraint of five sub-contexts per level forces cognitive discipline. The tool mirrors how attention works: one context at a time, full focus, with the structure holding everything else.

When you talk to the AI agent, it inhabits your entire sigil. When you navigate to a context, you and the agent agree on the level of abstraction. The periphery drops away for both of you.

## Core Concepts

### Sigil

A sigil is a recursive structure representing an application's domain model. It is persisted as a directory hierarchy on the file system. Each node is a **context** — a bounded domain at a particular level of abstraction.

The root context represents the application itself. Its children are the top-level domains. Their children are sub-domains, and so on. A sigil is not a specification to be reviewed — it is a shared mental space to be inhabited.

### Context

A context is the fundamental unit. It has:

- **Name**: the directory name on disk.
- **Domain language**: markdown defining what this context is, why it exists, and what it does — written in the language of this abstraction level. Stored as `language.md` (with backward compatibility for `spec.md`).
- **Machinery**: architectural choices, technology stack, design patterns, and constraints. Stored as `technical.md`. Optional — if absent, the containing sigil's machinery applies.
- **Sub-contexts**: up to 5 child contexts, each a subdirectory.

### Containment, Not Hierarchy

Contexts exist inside a containing sigil. They are not children of a parent — they are inhabitants of a shared space. The containing sigil's language emerges from the entanglements its inhabitants declare with each other.

### Sibling References

A context can address its siblings — the other contexts that share the same containing sigil. Sibling names are highlighted in the editor when used in domain language. The notation `neighbor.affordance` addresses a neighbor's public capability. You cannot reach inside a sibling. If you need to, the boundary is wrong.

### Entanglements

Sibling contexts can declare entanglements — formal integration relationships with strategic design policies:

- **Shared Kernel** — symmetric, shared code/model
- **Published Language** — symmetric, agreed interchange format
- **Customer-Supplier** — directional, upstream defines terms
- **Conformist** — directional, downstream conforms without influence
- **Anticorruption Layer** — directional, downstream translates
- **Separate Ways** — no integration

Entanglements are declared in the **Entanglements** view — an SVG graph where contexts are nodes. Drag from one to another to create an edge. Drag direction encodes upstream/downstream. Persisted as `entanglements.json`.

### Vision Statement

A short markdown document at the sigil root (`vision.md`) describing the application's purpose. Exists to prevent drift when deep in sub-contexts.

### Attention Providers

AI agents that attend to the sigil. Each provider has a name, API backend (Anthropic or OpenAI), API key, model, and an enabled flag. Multiple can be enabled simultaneously. The selected provider responds to the next message. Providers are configured in Settings and can be switched mid-conversation from the chat panel header.

### Chats

Multiple persistent chat conversations per sigil, stored as individual files in `chats/`. Each chat has a name and full message history. The most recently modified chat opens by default. Chats can be created, renamed, switched, and deleted from the chat panel header.

### AI Design Partner

The AI agent is not a reviewer. It is a design partner helping weave domain language. It maintains coherence across contexts, suggests clearer terms, sharper boundaries, better names. It thinks in the language of the domain, not in implementation.

The agent can directly modify the sigil through tool calls: create contexts, write domain language, write machinery, rename contexts, read specific contexts, write the vision statement. Changes appear in the UI immediately.

Response style is configurable: **laconic** (default) for short conversational paragraphs, or **detailed** for thorough reasoning.

## File System Structure

```
MyApp/
  vision.md
  language.md
  technical.md
  entanglements.json
  chats/
    chat-1711672800000.json
    chat-1711673400000.json
  Auth/
    language.md
    technical.md
    TokenManager/
      language.md
    SessionStore/
      language.md
  Billing/
    language.md
  Notifications/
    language.md
    technical.md
    EmailService/
      language.md
    PushService/
      language.md
```

Rules:

- Every context directory contains `language.md` (or `spec.md` for backward compatibility).
- `technical.md` is optional. When absent, the containing sigil's machinery governs.
- `vision.md` exists only at the root.
- `entanglements.json` can exist at any level that has sub-contexts.
- `chats/` directory at the root holds all chat conversations.
- Maximum 5 sub-contexts per context.
- Directory names are context names.

## User Interface

### Screen Layout

Three columns with collapsible, resizable side panels.

**Left panel** (collapsible, resizable):

Two tabs:
1. **Vision** — editable vision statement with edit/preview toggle.
2. **Tree** — full hierarchy. Click to navigate. Right-click for: Add Context, Rename, Open in Finder, Delete.

**Center** (top to bottom):

1. **Breadcrumb bar** — path from root to current context. Click segments to navigate. Click last segment to rename.
2. **Content toolbar** — left side: `[Language | Machinery | Entanglements]` segmented control. Right side: view mode icons (markup, split, preview). View mode icons hidden in Entanglements view.
3. **Editor area** — CodeMirror 6 markdown editor with sibling name highlighting. Three modes: markup source, side-by-side split, rendered preview. In Entanglements mode: SVG graph of sub-contexts with draggable edges and policy assignment.
4. **Sub-context bar** — bottom strip with named boxes for navigation. Double-click to enter. Right-click for rename/delete. Add button when fewer than 5 exist.

**Right panel — AI Chat** (collapsible, resizable):

- Chat switcher dropdown (when multiple chats exist). Double-click name to rename.
- New chat button (+), chat menu (...) for rename/delete.
- Attention provider switcher (when multiple enabled).
- Laconic/detailed toggle switch.
- Scrollable chat history with copy button on hover.
- Text input with draft persistence (survives crashes).
- Collapse button.

### Multi-Window

Each sigil opens in its own native macOS window. File > Open and File > Recent open new windows. Each window is independent with its own React instance. Settings are shared globally.

### Native Menu Bar

- **Sigil**: About, Settings (Cmd+,), Hide/Quit
- **File**: New Window (Cmd+N), Open Sigil (Cmd+O), Recent Sigils, Export (Cmd+E), Close Window (Cmd+W)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Maximize, Close + macOS auto window list
- **Help**: Sigil Help

### Settings

- **Appearance**: system/light/dark theme
- **Attention Providers**: list with enable/disable checkboxes, add/edit/delete. Model dropdown auto-populated from provider API.
- **Response Style**: laconic (default) / detailed
- **System Prompt**: expandable full-panel editor with monospace font

### Export

File > Export (Cmd+E) flattens the sigil into a single markdown document with heading depth following tree depth.

## Technology

**Tauri 2** desktop application. Rust backend, React + TypeScript frontend.

- **Frontend**: React 18, Vite, CodeMirror 6, react-markdown, CSS Modules.
- **Backend**: Rust commands for file system operations, AI API streaming with tool use, file watching via `notify` crate.
- **AI**: Anthropic tool_use API with sigil manipulation tools. OpenAI streaming for text responses.
- **Persistence**: `tauri-plugin-store` for settings, UI state, theme. localStorage for chat drafts. File system for all sigil data.
- **Distribution**: GitHub Actions builds `.dmg` for Apple Silicon and Intel. `tauri-plugin-updater` for auto-updates.
