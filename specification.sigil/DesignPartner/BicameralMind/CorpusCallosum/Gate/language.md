---
status: idea
---

# Gate

The decision mechanism of the @CorpusCallosum. Decides when a signal from the @RightHemisphere is strong enough to warrant waking the @LeftHemisphere, whether that turn should be at local capacity or at extended resolution, and forces the @LeftHemisphere to return control after a bounded turn.

Two judgments, both held here because the @LeftHemisphere cannot be trusted with either: if it were the judge, it would lock @attention in narrative and keep finding distinctions to no end. The @Gate judges from outside the narrative — based on the disturbance arriving from the @RightHemisphere, not on the story the @LeftHemisphere would tell about it.

First judgment: wake / do not wake. A disturbance must cross the @EscalationThreshold. Most of the time, no.

Second judgment: local turn / extended turn. Given we are waking, does the articulation required warrant #increase-resolution? Casual flagging ("wrong word, there again") stays local. Careful speech to the @user about something that matters — a semantic contradiction, an architectural worry, a repair the @user should understand — warrants the larger model.

Operates through !bounded-turn, !map-check, !gate-authority, !frequency-filtering, !amplitude-threshold, and !coherence-precedence.
