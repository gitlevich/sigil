---
status: idea
---

# Implementation

This is where we address the **how** of the @LeftHemisphere. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

The @LeftHemisphere is a high-resolution remote model accessed via API. It is not always running. It arrives when the @CorpusCallosum escalates — a signal from the @RightHemisphere strong enough to warrant high-resolution attention. It receives the current state: the @sigil tree, the @Memory, the @Spellbook, the specific signal that triggered escalation. It does its work and leaves.

In the context of @LeftHemisphere, @DesignPartner generates sentences that this @application's ontology allows, as LLM completions. @Coherence here means only meaningful sentences appear as completions. 

Otherwise, it isn't: the number of generated sentences feels unbounded, or the number is bounded but we get many meaningless sentences — in which case we need to constrain the spec's ontology further.

If the generations are coherent, we move on to @Sufficiency to see if all meaningful sentences we generated have been specified. If not, our @Sufficiency is insufficient: we need to speak these sentences into existence at lower and lower level of abstraction, until we have reached @primitives.

The vocabulary for generation is the lexical scope of the recognized @sigil — the @sigil itself, its children, siblings, and ancestors. The scope is the context. The @sigil is the focus. Results are written into the world: changed @sigils, new @Memory entries, new spells in the @Spellbook. The @LeftHemisphere retains nothing between invocations.

Acceptance criteria:

!vocabulary-bounded — generation uses the lexical scope of the recognized @sigil as its vocabulary

!stateless — the @LeftHemisphere retains nothing between invocations, each turn starts fresh

!output-in-world — results are written into @sigils, @Memory, or the @Spellbook, never kept as private state
