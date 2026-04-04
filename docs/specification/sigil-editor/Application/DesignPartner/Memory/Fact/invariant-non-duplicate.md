A fact must be distinct from all existing facts. Distinctness is measured by distance in @ContrastSpace. If a new fact's cosine similarity to its nearest existing neighbor exceeds the noise floor threshold (default 0.95), it is a near-duplicate and is discarded rather than stored.

This prevents memory from accumulating paraphrases of the same knowledge.