---
status: wip
---
# Shaping

Shaping is speaking a sigil into existence across four panels. Each panel is a projection of the same sigil at a different level of abstraction. Each declares what matters at its level, using the vocabulary established by the level above. Together they form a compilation chain: each level is the spec for the level below.

**UX** — the application spoken from the user's perspective. I declare @Affordances and group them into up to five @Experiences. An experience is what it is like to use this part of the application. The UX panel defines what the application must deliver. Nothing below this level can contradict it.

**Language** — the domain model spoken into existence. I define the concepts, relationships, and vocabulary that will deliver the affordances declared in UX. The language must be sufficient to express everything UX committed to. Contained sigils emerge here as I need subjects for the concepts I am describing.

**Architecture** — the model elaborated structurally. As an architect I declare the contrasts I care about at this level: what concerns must be separated, what must be co-located, what boundaries must hold. I speak each architectural decision into existence. What I do not declare remains in superposition — the implementing agent resolves it freely.

**Implementation** — where I have a preference over how something is built, I declare it here. Only preferences go here. Everything undeclared stays in superposition and is resolved by the agent.

The same four panels apply at every sigil in the hierarchy. The structure is fractal — the same shape at every level of containment. A sigil one level down is elaborated by its own four panels, constrained by what the containing sigil declared above it.


