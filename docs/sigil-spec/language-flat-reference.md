# Sigil

## Sigil

A sigil is a bounded context with recursive containment. It has a name, a boundary, and domain language written at its level of abstraction. Inside that boundary, it can contain up to five other sigils — each a bounded context in its own right.

A sigil is always contained in another sigil. There is no root in any absolute sense — what appears as "the root" in the tool is simply the sigil you opened, which itself exists in a larger context you're not looking at right now.

The limit of five comes from how human attention works: you cannot hold more than five to seven separate concepts at any level of detail. Complexity visible in any one context is always bounded.

A sigil has:

- **Name**: the directory name on disk. What makes it addressable.
- **Domain language**: the narrative at this level of abstraction — sentences woven from the names of the sigils it contains. Stored as `language.md`.
- **Contained sigils**: up to 5 sigils inside this one.

### Containment

A sigil is recursive: it is made of sigils. This is not a parent-child relationship — it is containment. The contained sigils inhabit the context of the containing sigil. They share that context.

The domain language of a containing sigil is woven from the names of the sigils it contains and the affordances they expose.

### Affordances

An affordance is a capability that a sigil makes visible across its boundary. It is not what happens inside — it is what can be addressed from outside. Every affordance belongs to a sigil — you cannot name a capability without naming who exposes it. This is how sigils get their names: whenever you articulate an affordance, you need a subject.

You cannot reach inside another sigil. You can only address it by name and use what it exposes. If you need to reach deeper, the boundary is wrong. The five-sigil limit bounds the complexity of any context's affordance surface. If a sigil exposes too many affordances, it needs to be decomposed further.

Affordances are referenced in two directions:

- **Down** — a containing sigil addresses the affordances of the sigils it contains. The container's domain language is woven from their names and their affordances.
- **Across** — a sibling addresses a neighbor's affordance. The notation `@Neighbor.affordance` references a sibling's capability from within your own context.

### Integrations

Sibling contexts can declare integrations — formal relationships with strategic design policies:

- **Shared Kernel** — symmetric, shared code/model
- **Published Language** — symmetric, agreed interchange format
- **Partners** — symmetric, both pursue the same goal and can only deliver it together
- **Customer-Supplier** — directional, upstream defines terms
- **Conformist** — directional, downstream conforms without influence
- **Anticorruption Layer** — directional, downstream translates
- **Separate Ways** — no integration

## Authoring

Authoring is the act of inhabiting a sigil and articulating its domain language.

### Writing Domain Language

One approach the author finds effective: inhabit the sigil. Close your eyes and imagine attending to this context. What do you reach for? What interactions should be effortless? What constraints do you feel? Describe that experience in the first person. The affordances emerge from articulating what you need when you're inside — not from listing what the system should do from outside.

### Vision

A short markdown document at the sigil root (`vision.md`) describing the application's purpose. Exists to prevent drift when deep in sub-contexts.

## Workspace

The workspace is where the author inhabits sigils and works with an AI design partner.

### AI Design Partner

The AI agent is not a reviewer. It is a design partner helping weave domain language. It maintains coherence across contexts, suggests clearer terms, sharper boundaries, better names. It thinks in the language of the domain, not in implementation.

The agent can directly modify the sigil through tool calls: create contexts, write domain language, rename contexts, delete contexts, read specific contexts, write the vision statement. Changes appear in the UI immediately.

Response style is configurable: **laconic** (default) for short conversational paragraphs, or **detailed** for thorough reasoning.

### AI Providers

AI agents that work alongside you in the sigil. Each provider has a name, API backend (Anthropic or OpenAI), API key, model, and an enabled flag. Multiple can be enabled simultaneously. The selected provider responds to the next message. Providers are configured in Settings and can be switched mid-conversation from the chat panel header.

### Chats

Multiple persistent chat conversations per sigil, stored as individual files in `chats/`. Each chat has a name and full message history. The most recently modified chat opens by default. Chats can be created, renamed, switched, and deleted from the chat panel header.
