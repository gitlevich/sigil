---
status: wip
---
# Relationships

A sigil can have relationship with its neighbors. This is how they talk to each other.

Strategic Design patterns constrain what relationships are allowed:

- **Shared Kernel** — symmetric, shared code/model
- **Published Language** — symmetric, agreed interchange format
- **Partners** — symmetric, both pursue the same goal and can only deliver it together
- **Customer-Supplier** — directional, upstream defines terms
- **Conformist** — directional, downstream conforms without influence
- **Anticorruption Layer** — directional, downstream translates
- **Separate Ways** — no integration
