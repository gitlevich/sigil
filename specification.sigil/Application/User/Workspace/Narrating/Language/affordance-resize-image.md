---
status: idea
---

Drag a corner handle on a rendered image to resize it visually while preserving aspect ratio. The new dimensions are persisted back into the markdown as an HTML img tag with explicit width, replacing the original markdown image syntax.

Acceptance:

- A resize handle appears on hover at the bottom-right corner of each image in preview/split mode
- Dragging the handle scales the image, constrained to aspect ratio
- On release, the markdown source is updated: `![](path)` becomes `<img src="path" width="Npx" />`
- If the image already has an explicit width, dragging updates it in place
- Minimum width: 64px — images cannot be resized smaller
- The resize interaction is smooth with no flicker or reflow during drag
- App only — the site viewer renders the persisted dimensions but offers no resize handle
