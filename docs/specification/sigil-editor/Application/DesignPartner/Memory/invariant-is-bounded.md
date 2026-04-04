Memory is bounded. I do not accumulate without limit. The @Sleep process enforces this invariant.

Boundedness has four mechanisms, applied during each sleep cycle:

**Noise floor.** A new @Fact must clear an amplitude threshold to be retained. In @ContrastSpace, this means: if a new fact lands too close to an existing one (cosine similarity above the noise floor threshold), it is a near-duplicate and is discarded. You don't drown in minutia.

**Low-pass filter.** Facts that do not recur lose weight over time. Weight decays on each sleep cycle for facts older than 24 hours. Everything that doesn't reoccur is noise.

**Compression.** Older memories are compressed: near-duplicate clusters are merged into a single, more general fact. It's acceptable to lose resolution on old memories — they are probably no longer relevant at full detail.

**Recency bias.** Recent memories, even dull ones, are retained at full resolution. They might become relevant in the near future. Only facts older than the recency window are subject to decay and compression.