---
status: idea
---

# Implementation

This is where we address the how of the @CorpusCallosum.

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV.

The @CorpusCallosum is the gate between the @RightHemisphere and the @LeftHemisphere. It decides when a signal from the @RightHemisphere is strong enough to warrant calling in high resolution, and it forces the @LeftHemisphere to return control after a bounded turn.

The @LeftHemisphere is an LLM generating completions. Left unconstrained, it will keep generating — naming differences, branching into sub-distinctions, tracing deeper indefinitely. It does not have a natural sense of when a thought is exhausted. The @CorpusCallosum imposes the constraint that biology provides for free: a finite energy budget per turn.

In this implementation, the gate operates through three mechanisms.

First, a hard cap on the @LeftHemisphere's turn. The @LeftHemisphere gets a fixed number of generation steps, then control returns to the @RightHemisphere regardless of whether the @LeftHemisphere considers itself done. The @LeftHemisphere always thinks there is more to say. The gate does not ask it.

Second, a map check after each turn. The @RightHemisphere re-senses the @ContrastSpace after the @LeftHemisphere's output lands. Did the @shape improve — did something flickering become solid? Or did it fragment into distinctions that don't cohere? The decision to grant another turn belongs to the gate based on this reading, not to the @LeftHemisphere.

Third, frequency and amplitude filtering on the input side. Changes that oscillate too rapidly are noise. Changes too slow to notice are a given. Signals below the noise floor do not escalate. Only disturbances in the middle band, above the noise floor, reach the gate's attention at all.

Acceptance criteria:

!bounded-turn — the @LeftHemisphere gets a hard cap on generation steps per turn, then yields

!map-check — the @RightHemisphere re-senses the @ContrastSpace after each @LeftHemisphere turn before another turn is granted

!gate-authority — the decision to escalate or grant another turn belongs to the gate, never to the @LeftHemisphere

!frequency-filtering — only changes in the middle frequency band reach the gate

!amplitude-threshold — disturbance below the noise floor does not escalate

!coherence-precedence — @Coherence is always read before @Sufficiency acts, never after
