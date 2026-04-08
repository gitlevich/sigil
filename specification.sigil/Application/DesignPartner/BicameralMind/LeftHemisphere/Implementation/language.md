---
status: idea
---

# Implementation

This is where address the **how** of this application. 

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV. 

This @sigil is below the level of abstraction relevant to @DesignPartner when designing other applications. It IS relevant when building this one.

Both @LeftHemisphere and @RightHemisphere participate in measuring @coherence, but differently. 

In the context of @LeftHemisphere, @DesignPartner generates sentences that this @application's ontology allows, as LLM completions. 

The result is coherent when only the meaningless sentences appear as completions. 

Otherwise, it isn't:

- the number of generated sentences feels unbounded
- the number is bounded but we get a lot of meaningless sentences

in which case we need to constrain the spec's ontology further.

If the generations are coherent, we move on to @sufficiency to see if all meaningful sentences we generated have been specified. If not, our @sufficiency is insufficient: we need to speak these sentences into existence at lower and lower level of abstraction, until we have reached @primitives. 