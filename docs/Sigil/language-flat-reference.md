# Sigil — flat reference

## Sigil

A sigil is an origin — a named center from which trajectories of attention grow outward. It has a name, a boundary, and narration written at its level of abstraction. Inside that boundary, it can contain other sigils — each beginning its own trajectory from its own center.

A sigil is always contained in another sigil. What appears as "the root" in the tool is simply the sigil you opened.

A sigil has:

- **Name**: the directory name on disk. What makes it addressable.
- **Language**: the narration at this level of abstraction. Stored as `language.md`.
- **Contained sigils**: sigils inside this one.
- **Edits**: the time-like growth history of the narration. Each edit is timestamped with an upstream snapshot.

## Trajectory

A path of narration from the root to a leaf. Each level of elaboration adds direction. The accumulated direction from every level above makes the projection at a leaf deterministic — not because everything is specified, but because everything that matters has been specified along the path.

**Precision** — how constrained a trajectory is. How many valid projections remain at its tip.

**Resolution** — the density of elaboration points along the surface. What has not been narrated is not a hole: it is unconstrained space the trajectory never entered.

## Containment

A sigil is recursive: it is made of sigils. Contained sigils inhabit the context of the containing sigil. The narration of a containing sigil is woven from the names of the sigils it contains and the affordances they expose.

## Affordances

An affordance is a capability that a contained sigil exposes to its siblings. Every affordance belongs to a sigil — you cannot name a capability without naming who exposes it.

Affordances are addressed with `@Sigil.affordance` notation.

## Frame

Sibling sigils can declare relationships — formal edges with strategic design policies:

- **Shared Kernel** — symmetric, shared code/model
- **Published Language** — symmetric, agreed interchange format
- **Partners** — symmetric, both pursue the same goal and can only deliver it together
- **Customer-Supplier** — directional, upstream defines terms
- **Conformist** — directional, downstream conforms without influence
- **Anticorruption Layer** — directional, downstream translates
- **Separate Ways** — no relationship

## Contrasts

Named contrasts the author explicitly cares about, each with a preference range along its axis. Each declared invariant fixes one dimension of the trajectory. What is not declared stays in superposition — a free direction the trajectory did not specify.

## DesignPartner

The DesignPartner is the runtime. It inhabits the entire sigil and responds in domain language. Language in, language out. It re-enters the memory formed by teaching — the accumulated narration in the sigil file structure. When you continue the conversation, you continue from where the structure says you are.

The partner can modify the sigil directly: create sigils, write language, rename, declare invariants. Changes appear immediately.

Response style is configurable: **laconic** (default) or **detailed**.

## Narrative

The growth history of a trajectory. Each edit is a delta to a sigil's narration, timestamped, with a snapshot of the upstream state when it was written.

Edits cluster into **bursts** — sessions of focused attention separated by **lulls**. The lull threshold is derived from the bimodal distribution of inter-edit gaps.

## Atlas

The space-like view of the sigil. A collection of maps, one per sigil. Each map shows the sigil at its own scale: contained sigils are named cells, deeper structure as anonymous subdivision. Relationships between neighbors are edges connecting cells.

**FocusedMode** — one level of containment at a time.
**RevealedMode** — full recursive depth, deeper structure as anonymous texture.
