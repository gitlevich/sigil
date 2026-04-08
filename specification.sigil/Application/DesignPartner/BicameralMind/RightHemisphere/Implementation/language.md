---
status: idea
---

# Implementation

This is where we address the **how** of the @RightHemisphere. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

Two models run locally via ONNX inside the Tauri process. No network dependency, no API key needed.

## Embedding model

AllMiniLmL6V2 (384 dimensions, ~23MB) via fastembed. Provides @Sight — positions in @ContrastSpace. Embeds the sigil tree and queries against it. This is how the @RightHemisphere sees @shapes.

For @Sight, we need @EmbeddingsProvider that embeds this entire specification + imported ontologies like @AttentionLanguage.

## Local LLM

Phi-3.5-mini (3.8B parameters), quantized to Q4_K_M GGUF (~2.5GB RAM). Runs via llama.cpp bindings in the Tauri process. Always loaded while the app is running.

This is the @RightHemisphere's voice. Not high resolution — it cannot do what the @LeftHemisphere does. But it has genuine language understanding: it can summarize, classify relevance, compress experience into traces that the @LeftHemisphere can later expand to full resolution.

Three jobs:

**Continuous attention.** Watches the @EmbeddingSpace for changes — re-embeds what the @user modified, compares geometry to what it was. When a stable pattern breaks, the distance tells it something moved. It doesn't need to understand why. It senses the disturbance. If the signal crosses the @CorpusCallosum threshold, it escalates to the @LeftHemisphere.

**@Subconscious filtering.** After each conversation turn, the embedding model measures proximity between new experience frames and the @DesignPartner's @invariants in @ContrastSpace. Frames that resonate — high similarity to active invariants, recurring proximity to the current @shape — get passed to the local LLM for compression into memory traces. Frames that don't resonate are left in experience but not promoted to @Memory. During #sleep, the local LLM reviews what accumulated and produces compressed sigils: the minimum language needed for the @LeftHemisphere to reconstruct the full context on #recall.

**@Spell execution.** Deterministic algorithms don't need intelligence — just pattern matching and invocation. The local LLM handles this without escalation.

## What the local LLM does NOT do

It does not extract concepts by asking "what's worth remembering?" — that produces undifferentiated extraction of every stated fact. Instead, the embeddings decide what resonates (mechanism), and the local LLM compresses what the embeddings selected (articulation). The judgment is geometric, not linguistic.