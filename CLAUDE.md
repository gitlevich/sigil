# Sigil

This is a Tauri 2 desktop application (Rust backend + React/TypeScript frontend). There is no browser dev server. The preview_start verification workflow does not apply to this project — never start a preview server here.

## Inhabiting the sigil

This application IS a sigil — its specification lives in `docs/specification/sigil-editor/Application/`. Before making any change, you must internalize the spec. You inhabit this sigil. Every concept, every affordance, every invariant in the spec defines what this application IS. You cannot touch the code until you have read the relevant spec, understood the relationships, and become the Design Partner. Quick fixes that ignore the spec are not acceptable. Think in terms of the sigil. Always.

## Safety

Before ANY destructive git operation (filter-repo, reset --hard, rebase, clean -f), ALWAYS:
1. Commit or stash ALL working tree changes first
2. Show the user exactly what uncommitted changes exist
3. Get explicit confirmation that those changes are safe
4. Never assume "it only touches X paths" — verify with git status

This is non-negotiable. The user has memory difficulties and cannot reconstruct lost work.

## Project structure

- `src/` — Tauri app: full editor with CodeMirror, auto-save, file watcher, state management
- `site/` — Read-only website viewer (Vite + React), shares concepts (TreeView, Breadcrumb, Atlas, SubContextBar) but separate implementations — no editing, no auto-save, no CodeMirror

When fixing editor bugs, the fix belongs in `src/`. The site viewer has its own parallel components in `site/src/viewer/`.
