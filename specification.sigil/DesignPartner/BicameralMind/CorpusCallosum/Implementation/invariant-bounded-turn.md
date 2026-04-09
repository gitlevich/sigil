# bounded-turn

The @LeftHemisphere gets a fixed number of generation steps per turn. When the cap is reached, control returns to the @RightHemisphere regardless of whether the @LeftHemisphere considers its work complete. This is not a soft suggestion. The turn ends.

This exists because the @LeftHemisphere has no natural exhaustion. An LLM will keep generating as long as there are tokens to predict. Each distinction it names creates new regions that look underspecified, inviting further distinction. Without a hard cap, attention gets captured: the @LeftHemisphere traces deeper and deeper, consuming all compute, while the @RightHemisphere starves. The result is over-specification — every leaf pinned, no breathing room, the shape lost.

The cap models what biology provides for free: a thought ends not because you chose to stop, but because you ran out of fuel on that thread.

Violation: the @LeftHemisphere runs for an unbounded number of steps, generating distinctions until it decides it is done. The @RightHemisphere never gets to re-sense the shape.
