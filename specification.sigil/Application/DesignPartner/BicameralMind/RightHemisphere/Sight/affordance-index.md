I #index a single file by reading its content, computing its content hash, checking if the hash matches what is already stored, and if not, re-embedding and upserting.

Long files are split into overlapping chunks (default 2048 characters, 256 character overlap) to preserve context at chunk boundaries. Most sigil files are short enough to be a single chunk.

Chunk boundaries prefer paragraph breaks, then sentence breaks. This keeps semantic units intact rather than splitting mid-thought.