---
status: idea
---

Drag, drop, or paste an image into the language panel. The image file is copied into an `assets/` directory alongside the current context's markdown file, and a relative markdown image link `![](assets/filename.png)` is inserted at the cursor position.

Acceptance:

- Drag-and-drop from filesystem onto the editor surface triggers insertion
- Paste from clipboard (screenshot, copied image) triggers insertion
- Supported formats: PNG, JPEG, GIF, SVG, WebP
- The original file is copied, never moved — the source is untouched
- If `assets/` does not exist, it is created silently
- Filename collisions are resolved by appending a numeric suffix
- Cursor is placed after the inserted link so typing continues naturally
- Works in both edit and split-preview modes
- App only — the site viewer is read-only and does not accept drops
