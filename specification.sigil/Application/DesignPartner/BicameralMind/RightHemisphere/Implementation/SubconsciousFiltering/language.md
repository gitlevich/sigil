---
status: idea
---

# Subconscious Filtering

After each conversation turn, the embedding model measures proximity between new experience frames and the @DesignPartner's @invariants in @ContrastSpace. Frames that resonate — high similarity to active invariants, recurring proximity to the current @shape — get passed to the local LLM for compression into memory traces. Frames that don't resonate are left in experience but not promoted to @Memory. During #sleep, the local LLM reviews what accumulated and produces compressed sigils: the minimum language needed for the @LeftHemisphere to reconstruct the full context on #recall.
