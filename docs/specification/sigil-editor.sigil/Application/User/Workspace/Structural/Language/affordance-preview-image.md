---
status: idea
---

Render images in preview mode, split-preview mode, and the read-only site viewer. Two sources:

1. **Structural images**: If the sigil's directory contains files named `image.*`, `image-1.*`, `image-2.*`, etc. (jpg, png, gif, svg, webp), they render automatically at the top of the preview, in numerical order. No markdown syntax needed — an image IS part of the sigil, like `language.md`.

2. **Inline images**: Standard markdown image syntax `![alt](path)` renders inline within the narrative. Also supports `<img src="path" width="Npx" />` for images with explicit dimensions (persisted by #resize-image).

Acceptance:

- Structural images render above the narrative, in order: `image`, `image-1`, `image-2`, ...
- Structural images require no editing — they are not in the markdown, they are in the directory
- Inline image paths resolve relative to the sigil's directory
- Images scale to fit the panel width, never overflowing
- Broken image links show a subtle placeholder, not a raw error
- Both app (preview/split) and site viewer render images identically
