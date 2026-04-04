The index updates incrementally. Only files whose content hash has changed since last indexing are re-embedded. This makes reindexing proportional to what changed, not to the total size of the sigil tree.

Content hash is SHA-256 of the file's full text. The hash is stored alongside the embedding in the database.