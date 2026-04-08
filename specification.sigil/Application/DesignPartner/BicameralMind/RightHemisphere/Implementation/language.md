---
status: idea
---

# Implementation

This is where we address the **how** of the @RightHemisphere. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

Two models run locally via ONNX inside the Tauri process. No network dependency, no API key needed.

The embedding model (AllMiniLmL6V2, 384 dimensions) provides @Sight — positions in @ContrastSpace. It embeds the sigil tree and queries against it. This is how the @RightHemisphere sees shapes.

The local LLM provides continuous attention. Small, cheap, always running. It watches the embedding space for changes — re-embeds what the @user modified, compares geometry to what it was. When a stable pattern breaks, the distance tells it something moved. It doesn't need to understand why. It senses the disturbance. If the signal crosses the @CorpusCallosum threshold, it escalates to the @LeftHemisphere.

The local LLM also executes @Spells. Deterministic algorithms don't need intelligence — just pattern matching and invocation.

For @Sight, we need @EmbeddingsProvider that embeds this entire specification + imported ontologies like @AttentionLanguage.