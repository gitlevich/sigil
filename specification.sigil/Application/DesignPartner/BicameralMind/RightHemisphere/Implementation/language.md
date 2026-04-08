---
status: idea
---

# Implementation

This is where we address the **how** of the @RightHemisphere. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

This branch is done when @DefinitionOfDone says the mechanism is trustworthy enough to wear.

Two models run locally via ONNX inside the Tauri process. No network dependency, no API key needed.

## Embedding model

AllMiniLmL6V2 (384 dimensions, ~23MB) via fastembed. Provides @Sight — positions in @ContrastSpace. Embeds the sigil tree and queries against it. This is how the @RightHemisphere sees @shapes.

For @Sight, we need @EmbeddingsProvider that embeds this entire specification + imported ontologies like @AttentionLanguage.

## Local LLM

Phi-3.5-mini (3.8B parameters), quantized to Q4_K_M GGUF (~2.5GB RAM). Runs via llama.cpp bindings in the Tauri process. Always loaded while the app is running.

This is the @RightHemisphere's voice. Not high resolution — it cannot do what the @LeftHemisphere does. But it has genuine language understanding: it can summarize, classify relevance, compress experience into traces that the @LeftHemisphere can later expand to full resolution.

Three jobs:

@ContinuousAttention watches the @EmbeddingSpace for changes. 

@SubconsciousFiltering selects what get remembered.

@SpellExecution takes care of autonomic behavior.

## What the local LLM does NOT do

It does not extract concepts by asking "what's worth remembering?" — that produces undifferentiated extraction of every stated fact. Instead, the embeddings decide what resonates (mechanism), and the local LLM compresses what the embeddings selected (articulation). The judgment is geometric, not linguistic.
