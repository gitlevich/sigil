---
status: idea
---
# Lifecycle

A sigil progresses through states: **idea**, **wip**, **ready**, **implemented**.

- **idea** — captured, not yet explored. A placeholder for something that needs definition.
- **wip** — actively being defined. The language is forming.
- **ready** — language is stable. Implementation can begin.
- **implemented** — the definition is realized.

Transitions are constrained: a sigil cannot be implemented until all its contained sigils are implemented. A sigil cannot be ready while its language is still changing. State changes are constrained — the author selects from valid transitions.
