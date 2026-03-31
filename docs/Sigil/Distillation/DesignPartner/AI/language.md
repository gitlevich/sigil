---
status: wip
---
# AI

The AI partner is the primary runtime for @DesignPartner. It is an LLM — given the sigil as context, it responds from inside it. The sigil is loaded as the system prompt: every trajectory, every level of narration, every declared invariant. The model speaks the domain language as if it had written it.

The partner is prompted with its role: inhabit the sigil, respond in domain language, detect incoherence in the trajectory structure, modify the sigil when the conversation establishes new direction. It has access to the full tool surface: read sigil structure, write language, create and rename sigils, declare invariants.

Multiple AI providers can serve as the partner — Anthropic, OpenAI, or others. Multiple can be enabled simultaneously. The selected provider responds to the next message. The model selection trades capability against cost and latency depending on the task: quick navigational questions need less than structural reorganization.

@SigilCoherence runs as a background process alongside the conversation — embedding the trajectories and surfacing gaps to the partner, so that the partner can attend to them without being explicitly asked.
