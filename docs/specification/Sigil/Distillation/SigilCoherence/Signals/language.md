---
status: wip
---
# Signals

A signal is a dimension the author explicitly cares about — named because attention is tuned to it. Declaring a signal defines the membrane along one dimension: it states what must hold regardless of implementation choices, and specifies a preferred range along that axis. Everything else is noise — the implementing agent resolves it freely.

Signals are discovered iteratively. The author cannot fully enumerate them in advance. When an implementation produces something unexpected — a distracting color, a boundary that doesn't read clearly — the author has found a hidden signal. The surprise is the detection. The signal is named, the preferred range is stated, the membrane tightens in that direction. The process repeats until the agent converges on implementations the author accepts.

**Accidental gap** — a signal the author implicitly assumed but did not declare. Detected when affordances reference concepts with no specified boundary. The agent fills these gaps arbitrarily.

**Intentional gap** — a free dimension, not a gap. No signal covers it. I have decided this axis is unconstrained because I have no preferred range on it: I simply don't care.
