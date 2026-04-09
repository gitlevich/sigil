---
status: idea
---

# Local LLM

Phi-3.5-mini (3.8B parameters), quantized to Q4_K_M GGUF (~2.5GB RAM). Runs via llama.cpp bindings in the Tauri process. Always loaded while the app is running.

## What the local LLM does NOT do

It does not extract concepts by asking "what's worth remembering?" — that produces undifferentiated extraction of every stated fact. Instead, the embeddings decide what resonates (mechanism), and the local LLM compresses what the embeddings selected (articulation). The judgment is geometric, not linguistic.
