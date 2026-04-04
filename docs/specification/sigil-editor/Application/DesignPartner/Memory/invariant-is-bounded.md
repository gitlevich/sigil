Memory is bounded. I do not accumulate without limit. The @Sleep process enforces this invariant.

Boundedness has four mechanisms, applied during each sleep cycle:

**Noise floor.** A new concept must clear an amplitude threshold to be retained. In @ContrastSpace, this means: if a new concept's language lands too close to an existing one (cosine similarity above the noise floor threshold), it is a near-duplicate and is merged rather than kept separate. You don't drown in minutia.

**Low-pass filter.** Concepts that do not recur lose weight over time. Weight decays on each sleep cycle for concepts older than 24 hours. Everything that doesn't reoccur is noise.

**Compression.** Older concepts are compressed: near-duplicate clusters are merged into a single, more general concept sigil. It's acceptable to lose resolution on old memories — they are probably no longer relevant at full detail.

**Recency bias.** Recent concepts, even dull ones, are retained at full resolution. They might become relevant in the near future. Only concepts older than the recency window are subject to decay and compression.
