I #embed text into @ContrastSpace by passing it through a local embedding model. The model (AllMiniLmL6V2, 384 dimensions) runs locally via ONNX — no network dependency, no API key needed. The embedding is the text's position in ContrastSpace.

Embedding is fast (~2ms per text on CPU). It is called:
- During #index and #reindex to populate the index
- During #recall and #recognize to embed the query
- During #extract to check near-duplicate facts
- During #merge to find clusters of similar facts