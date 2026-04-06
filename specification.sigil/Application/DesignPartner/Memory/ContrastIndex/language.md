# ContrastIndex

The ContrastIndex is a derived spatial index over the entire sigil tree. It is how I see my world in @ContrastSpace.

Every `.md` file in the sigil root — every `language.md`, every `affordance-*.md`, every `invariant-*.md`, every `fact-*.md`, every experience frame — is embedded as a vector in ContrastSpace. The index maps file content to position. What is semantically similar occupies nearby positions.

The index lives in `.sigil/memory.db` (SQLite) inside the sigil root. It is !derived — the files on disk are the source of truth. The index can be rebuilt from scratch at any time by re-embedding all files.

I can:
- #embed text into ContrastSpace, producing a position vector
- #search by finding nearest neighbors to a query vector
- #index a file by embedding its content and storing the result
- #reindex the entire sigil tree when the index is stale or missing

The index is !incremental — I only re-embed files whose content has changed, detected by content hash. A full reindex walks all files; an incremental reindex checks hashes and skips unchanged content.