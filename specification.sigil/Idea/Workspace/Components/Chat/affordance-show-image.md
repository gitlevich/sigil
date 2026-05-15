---
status: idea
---

# Show DesignPartner an image

I show @DesignPartner an image as part of our conversation, the way I'd hold one up to a friend. I drag a file onto the chat input, paste from my clipboard, or click an attach control and pick. The image rides along with my next message; he @Sight#see-image and we can talk about what is there.

Acceptance:

- Drag-and-drop a file from the filesystem onto the chat input area attaches it
- Paste from clipboard (screenshot, copied image) attaches it
- An attach control opens a native file picker
- Supported formats: PNG, JPEG, GIF, SVG, WebP
- Attached images appear as thumbnails above the input before send; each has a remove control
- Original bytes are preserved — never resized, never recompressed (per @Idea/!is-an-image-centric-application)
- The image is copied into the @sigil's `.private/chats/attachments/<chatId>/` so it persists with the chat history
- On send, the image is delivered to the partner's vision-capable attention provider as part of the user turn
- If the active provider has no vision (local sidecar, text-only Ollama), the partner says so rather than silently dropping the image
