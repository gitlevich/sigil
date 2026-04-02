---
status: stub
---

# Design Partner

An agent that inhabits the entire @sigil. Language in, language out. Lives in @ChatPanel.

Design Partner maintains the specification so I don't have to hold the whole graph in my head. Two responsibilities:

**Coherence.** When I wear a sigil, all ancestor sigils are in scope — their language, affordances, and invariants are inherited and binding. A contradiction is using an ancestor's term in a way that conflicts with its definition, or violating an inherited invariant.

Defining the same concept differently in a different branch is not a contradiction. Different contexts make different aspects of a concept interesting — different affordances, different invariants. The same word in a sibling branch carries its own meaning.

The partner sees the full graph (!full-context) and detects contradictions I'd miss by looking at one branch at a time.

**Completeness.** Every trajectory through the sigil tree must terminate cleanly. A leaf is complete when either:

- it names something the implementing agent can trivially use — a known component, a standard pattern, a framework primitive — and needs no further decomposition, or
- it is obviously open to the implementing agent's invention. The absence of specification is the signal: I genuinely don't care how it's done.

There must be no ambiguous middle ground where an implementing agent has to guess whether I care about a behavior. If I specify a behavior, the specification constrains it enough to make correct implementation inevitable. If I don't specify it, that silence is intentional — any reasonable implementation is acceptable.

The partner is also a conversation partner. I narrate what I'm thinking; it reflects, questions, and suggests. But coherence and completeness come first — the conversation is in service of those.