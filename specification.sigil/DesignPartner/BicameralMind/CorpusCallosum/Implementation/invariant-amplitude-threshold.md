# amplitude-threshold

The disturbance signal must exceed a noise floor before the gate considers escalation. Small perturbations — a typo fix, a formatting change, a trivially local rewording — do not cross the threshold no matter how they score on frequency filtering.

This works together with Sight's semantic-stability invariant. Sight determines that a cosmetic edit is geometrically insignificant. The amplitude threshold ensures that insignificant signals don't even reach the gate's decision logic.

The threshold is not fixed. It should adapt to the baseline noise level of the workspace. A workspace with heavy active editing has a higher noise floor than one where the user is reading without changing anything.

Violation: a trivially small disturbance — well below the noise floor — triggers escalation to the @LeftHemisphere.
