# frequency-filtering

The gate acts as a band-pass filter on the rate of change. Signals that oscillate too rapidly — edits happening faster than the @RightHemisphere can sense them — are noise. The shape hasn't settled; there is nothing stable to escalate about. Signals that change too slowly — structure that has been the same for so long it is background — are a given. Neither reaches the gate.

Only the middle band matters: changes happening at a rate where the @RightHemisphere can sense a stable shift but where the shift is recent enough to be worth attending to.

In practice this means the gate ignores flurries of rapid edits until they settle, and it ignores regions that haven't changed since the last sensing cycle. The implementation needs a window — recent enough to be active, stable enough to be real.

Violation: rapid-fire edits each individually trigger escalation, flooding the @LeftHemisphere with noise before a shape has formed. Or: a meaningful structural change is ignored because it happened slowly across many sessions.
