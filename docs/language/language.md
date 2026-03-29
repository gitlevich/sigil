# Sigil

## Vision

Sigil is a tool for structuring how you think about a system and sharing that structure with AI. A sigil is a tree of bounded contexts, each defining domain language at its level of abstraction. The constraint of five sub-contexts per level forces cognitive discipline. The tool mirrors how attention works: one context at a time, full focus, with the structure holding everything else.

When you talk to the AI agent, it inhabits your entire sigil. When you navigate to a context, you and the agent agree on the level of abstraction. The periphery drops away for both of you.

## Core Concepts

### Sigil

A sigil is a named pattern that attention recognizes. It has a boundary, and inside that boundary you can define other sigils — up to five. The boundary is what makes it a bounded context. The name is what makes it addressable. The entanglements are its behavior — how it relates to its neighbors.

A sigil is always contained in another sigil. There is no root in any absolute sense — what appears as "the root" in the tool is simply the sigil you opened, which itself exists in a larger context you're not looking at right now.

A sigil without attention is inert. When an attention — human or AI — attends to a sigil, it comes alive. The attention powers it. Multiple attentions can attend to the same sigil simultaneously.

Inside a containing sigil, you write sentences using the names of the sigils it contains. That's the domain language of that level — a narrative woven from up to five named concepts. Each of those concepts is itself a sigil, with its own interior, its own five concepts, its own narrative. But from outside, you only see the name and the entanglements.

A sigil has:

- **Name**: the directory name on disk. What makes it addressable.
- **Domain language**: the narrative at this level of abstraction — sentences woven from the names of the sigils it contains. Stored as `language.md`.
- **Contained sigils**: up to 5 sigils inside this one.

### Containment

A sigil contains sigils. This is not a parent-child relationship — it is containment. The contained sigils inhabit the space the containing sigil defines. They share that space.

The language of a containing sigil is not imposed from above. It emerges from the entanglements its inhabitants declare with each other. The inhabitants define the language of the space they share.

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
