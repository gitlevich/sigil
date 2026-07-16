# What is a sigil?

A sigil is a **bounded context**, in the sense of domain-driven design: a named region of language in which each word is overridden to mean one exact thing. Its boundary carries two lists: affordances — what can be done here — and invariants — what must stay true here. The whole tree of sigils is a **domain model** of the application, written in a ubiquitous language. In the model on this site, each sigil is a directory: a narrative written in the names of its children, one file per affordance, one per invariant, and the child sigils as subdirectories.

A door is a good model. From outside, a door is a name and a recognizable boundary, and it matters for what it affords: entry. From inside, it is a whole place. A sigil's name makes it available from outside; entering opens the whole place for work.

## Attention

The definition rests on a small model of attention, imported into the model as a library and modeled there with the same rigor as the application itself.

Attention is the given. An observer is attention paid from a point of view. Attention works in two modes: space-like, taking in what is present all at once as a field of possible distinctions, and time-like, following one sequence — a narrative, a conversation, a text. Token streams are time-like. The structures they describe are space-like. An application lives in both: imagined all at once, written one sentence at a time.

Each distinction attention can make — inside or outside, allowed or forbidden, mine or another's — is a contrast. Together the contrasts span a space, and a thing is a region in that space: the set of distinctions that hold about it. A sigil names such a region and writes its boundary down. The invariants state which contrasts must keep holding. The affordances state what can be done while they do.

## Why it helps

Attention is finite: a few concepts at a time. A sigil protects attention. While I work inside one, its language fills the working scope, and everything beyond it is reachable by name — the way an identifier resolves outward through enclosing scopes in a programming language. The tree as a whole can grow past what anyone can hold while each room stays small enough for attention.

## The map

A narrative of using an application traces one path across its domain. It compresses the domain around one goal, preserving the contrasts relevant to that route. A map keeps the whole terrain, so a goal can be chosen after the fact and any route taken. Many narratives, told and refined, begin to agree about such a shape. A domain expert sees the shape and can choose any route across it, orienting by sight. Sigil engineering makes the shape explicit: a tree of named contexts, precise enough that a coding agent can walk it and produce the application.

## Inhabiting a sigil

A sigil can be inhabited directly. Give an attention one tool for each affordance — a service that carries it out — and let it wear the sigil. From inside, it reads the domain language and already knows which contrasts must hold and what may be done; the boundary tells it what is relevant. Building the application becomes building the tools and wiring them into the sigil. The running application is the sigil, its tools, and the attention that inhabits it.

To inhabit a sigil is to be embodied by it. Inside, an attention has state — a position in the contrast space, a place in an ongoing narrative — and that is a kind of body: a here from which the rest is periphery. The interaction surface is the cockpit of that body. A cockpit has to bring the right affordance to hand at the right moment, which is what Christopher Alexander meant by a pattern language: each element answering a recurring need in its context. A sigil made well focuses the attention that powers it, human or otherwise.

## The name

In its older use, a sigil is a sign that binds an intention. The borrowed sense is exact: a sigil binds meaning to a name and holds it.

The vocabulary on this page — attention, contrast, affordance, invariant, sigil — is itself modeled, as sigils, in the model's library of imported ontologies. The definitions live inside the method; they are written in it. [Read them in the model viewer.](#/viewer)
