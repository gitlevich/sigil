# Sigil

This is a Tauri 2 desktop application (Rust backend + React/TypeScript frontend). There is no browser dev server. The preview_start verification workflow does not apply to this project — never start a preview server here.

## Project structure

- `src/` — Tauri app: full editor with CodeMirror, auto-save, file watcher, state management
- `site/` — Read-only website viewer (Vite + React), shares concepts (TreeView, Breadcrumb, Atlas, SubContextBar) but separate implementations — no editing, no auto-save, no CodeMirror

When fixing editor bugs, the fix belongs in `src/`. The site viewer has its own parallel components in `site/src/viewer/`.
