# Technology

**Tauri 2** desktop application. Rust backend, React + TypeScript frontend.

- **Frontend**: React 18, Vite, CodeMirror 6, react-markdown, CSS Modules.
- **Backend**: Rust commands for file system operations, AI API integration with tool use, file watching via `notify` crate.
- **AI**: Anthropic and OpenAI APIs with tool use for sigil manipulation.
- **Persistence**: `tauri-plugin-store` for settings, UI state, theme. `tauri-plugin-window-state` for window position and size. localStorage for chat drafts. File system for all sigil data.
- **Distribution**: GitHub Actions builds `.dmg` for Apple Silicon and Intel. `tauri-plugin-updater` for auto-updates.

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
