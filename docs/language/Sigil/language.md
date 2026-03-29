# Sigil

A sigil is a bounded context with recursive containment. It has a name, a boundary, and domain language written at its level of abstraction. Inside that boundary, it can contain up to five other sigils — each a bounded context in its own right.

A sigil is always contained in another sigil. There is no root in any absolute sense — what appears as "the root" in the tool is simply the sigil you opened, which itself exists in a larger context you're not looking at right now.

The limit of five comes from how human attention works: you cannot hold more than five to seven separate concepts at any level of detail. Complexity visible in any one context is always bounded.

A sigil has:

- **Name**: the directory name on disk. What makes it addressable.
- **Domain language**: the narrative at this level of abstraction — sentences woven from the names of the sigils it contains. Stored as `language.md`.
- **Contained sigils**: up to 5 sigils inside this one.

A sigil is made of sigils (@Containment). It exposes capabilities across its boundary (@Affordance). Sibling sigils declare formal relationships with each other (@Integration).
