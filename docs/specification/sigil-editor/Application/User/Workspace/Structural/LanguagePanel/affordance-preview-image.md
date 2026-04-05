---
status: idea
---

Render images inline wherever standard markdown image syntax `![alt](path)` appears, in preview mode, split-preview mode, and the read-only site viewer.

Acceptance:

- Relative paths resolve from the markdown file's directory
- Images scale to fit the panel width, never overflowing
- Broken image links show a subtle placeholder, not a raw error
- Both app (preview/split) and site viewer render images identically
- No layout shift — the image area reserves space before the image loads
