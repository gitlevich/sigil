# Sigil

## Core Concepts

### Sigil

A sigil is a bounded context with recursive containment. It has a name, a boundary, and domain language written at its level of abstraction. Inside that boundary, it can contain up to five other sigils — each a bounded context in its own right.

A sigil is always contained in another sigil. There is no root in any absolute sense — what appears as "the root" in the tool is simply the sigil you opened, which itself exists in a larger context you're not looking at right now.

The limit of five comes from how human attention works: you cannot hold more than five to seven separate concepts at any level of detail. Complexity visible in any one context is always bounded.

A sigil has:

- **Name**: the directory name on disk. What makes it addressable.
- **Domain language**: the narrative at this level of abstraction — sentences woven from the names of the sigils it contains. Stored as `language.md`.
- **Contained sigils**: up to 5 sigils inside this one.

### Containment

A sigil is recursive: it is made of sigils. This is not a parent-child relationship — it is containment. The contained sigils inhabit the context of the containing sigil. They share that context.

The domain language of a containing sigil is woven from the names of the sigils it contains and the affordances they expose.

### Affordances

An affordance is a capability that a sigil makes visible across its boundary. It is not what happens inside — it is what can be addressed from outside. You cannot reach inside another sigil. You can only address it by name and use what it exposes. If you need to reach deeper, the boundary is wrong.

Affordances are referenced in two directions:

- **Down** — a containing sigil addresses the affordances of the sigils it contains. The container's domain language is woven from their names and their affordances.
- **Across** — a sibling addresses a neighbor's affordance. The notation `@Neighbor.affordance` references a sibling's capability from within your own context.

Sibling names and affordance references are highlighted in the editor.

### Integrations

Sibling contexts can declare integrations — formal relationships with strategic design policies:

- **Shared Kernel** — symmetric, shared code/model
- **Published Language** — symmetric, agreed interchange format
- **Partners** - symmetric, both pursue the same goal and can only deliver it together
- **Customer-Supplier** — directional, upstream defines terms
- **Conformist** — directional, downstream conforms without influence
- **Anticorruption Layer** — directional, downstream translates
- **Separate Ways** — no integration

Integrations are declared in the **Integrations** view — an SVG graph where contexts are nodes. Drag from one to another to create an edge. Drag direction encodes upstream/downstream. Persisted as `integrations.json`.

### Writing Domain Language

One approach the author finds effective: inhabit the sigil. Close your eyes and imagine attending to this context. What do you reach for? What interactions should be effortless? What constraints do you feel? Describe that experience in the first person. The affordances emerge from articulating what you need when you're inside — not from listing what the system should do from outside.

### Vision Statement

A short markdown document at the sigil root (`vision.md`) describing the application's purpose. Exists to prevent drift when deep in sub-contexts.

### AI Providers

AI agents that work alongside you in the sigil. Each provider has a name, API backend (Anthropic or OpenAI), API key, model, and an enabled flag. Multiple can be enabled simultaneously. The selected provider responds to the next message. Providers are configured in Settings and can be switched mid-conversation from the chat panel header.

### Chats

Multiple persistent chat conversations per sigil, stored as individual files in `chats/`. Each chat has a name and full message history. The most recently modified chat opens by default. Chats can be created, renamed, switched, and deleted from the chat panel header.

### AI Design Partner

The AI agent is not a reviewer. It is a design partner helping weave domain language. It maintains coherence across contexts, suggests clearer terms, sharper boundaries, better names. It thinks in the language of the domain, not in implementation.

The agent can directly modify the sigil through tool calls: create contexts, write domain language, rename contexts, delete contexts, read specific contexts, write the vision statement. Changes appear in the UI immediately.

Response style is configurable: **laconic** (default) for short conversational paragraphs, or **detailed** for thorough reasoning.

## File System Structure

```
MyApp/
  vision.md
  language.md
  integrations.json
  chats/
    chat-1711672800000.json
    chat-1711673400000.json
  Auth/
    language.md
    TokenManager/
      language.md
    SessionStore/
      language.md
  Billing/
    language.md
  Notifications/
    language.md
    EmailService/
      language.md
    PushService/
      language.md
```

Rules:

- Every context directory contains `language.md` (or `spec.md` for backward compatibility).
- `vision.md` exists only at the root.
- `integrations.json` can exist at any level that has sub-contexts.
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
2. **Content toolbar** — left side: `[Language | Integrations]` segmented control. Right side: view mode icons (markup, split, preview). View mode icons hidden in Integrations view.
3. **Editor area** — CodeMirror 6 markdown editor with sibling name highlighting. Three modes: markup source, side-by-side split, rendered preview. In Integrations mode: SVG graph of sub-contexts with draggable edges and policy assignment.
4. **Sub-context bar** — bottom strip with named boxes for navigation. Double-click to enter. Right-click for rename/delete. Add button when fewer than 5 exist.

**Right panel — AI Chat** (collapsible, resizable):

- Chat switcher dropdown (when multiple chats exist). Double-click name to rename.
- New chat button (+), chat menu (...) for rename/delete.
- AI provider switcher (when multiple enabled).
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
- **View**: Toggle Word Wrap (Alt+Z)
- **Window**: Minimize, Maximize, Close + macOS auto window list
- **Help**: Sigil Help

### Settings

- **Appearance**: system/light/dark theme
- **AI Providers**: list with enable/disable checkboxes, add/edit/delete. Model dropdown auto-populated from provider API.
- **Response Style**: laconic (default) / detailed
- **System Prompt**: expandable full-panel editor with monospace font

### Export

File > Export (Cmd+E) flattens the sigil into a single markdown document with heading depth following tree depth.

## Technology

**Tauri 2** desktop application. Rust backend, React + TypeScript frontend.

- **Frontend**: React 18, Vite, CodeMirror 6, react-markdown, CSS Modules.
- **Backend**: Rust commands for file system operations, AI API integration with tool use, file watching via `notify` crate.
- **AI**: Anthropic and OpenAI APIs with tool use for sigil manipulation.
- **Persistence**: `tauri-plugin-store` for settings, UI state, theme. `tauri-plugin-window-state` for window position and size. localStorage for chat drafts. File system for all sigil data.
- **Distribution**: GitHub Actions builds `.dmg` for Apple Silicon and Intel. `tauri-plugin-updater` for auto-updates.
