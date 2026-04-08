---
status: idea
---

# Implementation

This is where we address the **how** of the @RightHemisphere. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

A small local model running continuously inside the app. Always on. Low resolution — it can sense the gestalt, feel asymmetry, notice that something changed. It cannot articulate what. That's not its job.

Two models run locally via ONNX inside the Tauri process. No network dependency, no API key needed: @EmbeddingModel and @LocalLLM.

This is the @RightHemisphere's voice. Not high resolution — it cannot do what the @LeftHemisphere does. But it has genuine language understanding: it can summarize, classify relevance, compress experience into traces that the @LeftHemisphere can later expand to full resolution.

Three jobs:

#ContinuousAttention watches the @EmbeddingSpace for changes. 

@Subconscious#filtering selects what get remembered.

@Subconscious takes care of autonomic behavior.

This implementation is done when all acceptance criteria of the @DefinitionOfDone are met.