I #reindex the entire sigil tree by walking all `.md` files under the sigil root, skipping hidden directories (`.sigil/`), chat storage (`chats/`), and `node_modules/`.

Reindex is incremental by default: each file's content hash is compared against the stored hash. Only changed files are re-embedded. Stale entries (files that no longer exist on disk) are removed.

Full reindex happens:
- On first initialization (the index is empty)
- On explicit user request via the reindex command
- When the index appears corrupted or stale