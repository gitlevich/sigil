# Sigil Engineering

How to speak an app into being.

A method for writing an imagined application down precisely enough that an agent can inhabit it — not only build it.

## Story

An application begins as a shape in my head: what it contains and what it must do for me.

The shape is space-like: all of it at once. Language is time-like: one sentence after another. Sigil engineering turns the shape into a domain model — the application in words, in the sense of domain-driven design — without losing the shape.

I write the vision first and keep it visible, because attention drifts. Then I name the affordances: the few things the application must let me do.

I describe how each affordance works. Some words in the description need definitions of their own. I define each one a level down and describe again from there. Where the language is still vague, I go down again.

Each defined word becomes a [sigil](#/sigil): a bounded context with its own affordances (what can be done in it) and invariants (what must hold), inside which every word is overridden to mean one exact thing. Sigils nest. The tree gets as deep as needed; each level stays small enough to hold in attention at once.

An AI design partner works in the same workspace. It reads the whole tree while I work in one context, compares the structure against the vision, and reports drift and broken boundaries.

I stop when naming a leaf is enough: a door handle affords opening the door, and I do not care how it is made. At that point the model carries the full shape, and a coding agent can project it into code. Implementation is projection.

But projection into code is not the only way to run a model. A model is a world, and an agent can inhabit it. Give the agent one tool for each affordance — a service that performs it — and let it wear the sigil: it reads the domain language, and from inside the context it already knows which contrasts must hold and what may be done. Building the application collapses to building the tools; the agent wires them into the sigil and lives there. The running application is the attention that lives there.

Inside, the agent has a body. It has state — a position in the contrast space, a place in an ongoing narrative — and the boundary decides what is relevant. The interaction surface is the cockpit of that body, and a cockpit has to bring the right affordance to hand at the right moment. That is what a pattern language is, in Christopher Alexander's sense: each affordance answering a recurring need in its context. A sigil made well focuses the attention that powers it.

## Pull quote

The model, the method, and the tool are the same shape.

## The Attempt: Sigil, an editor.

One attempt at implementing the method exists: an editor, also called Sigil. In it I write plain markdown with the vision one keystroke away. The ontology tree records each sigil as it appears. A compiler counts every reference that fails to resolve: vague language is a build error.

The tree has several views. Atlas is a treemap of the whole model; it shows which regions are dense and which are empty. Space draws the tree as nested spheres, viewed from inside a sigil or from outside.

The design partner works in the same workspace with the same tools I hold: it navigates, reads and writes sigils, renames, moves, deletes, edits affordances and invariants, searches the web. I can talk with it, or work and let it see the changes. Its character is part of the model, written as a sigil.

The editor is an early experiment, not a finished tool: the design partner's memory and parts of the runtime are still toys, and my attention has moved for now to applications built this way. I keep it public because the point is the method, not the app.

## The Proof: The loop closes.

The method's model is written with the method. A coding agent projected the editor from that model, and the model is written inside the editor, with the partner the model describes: the loop closes on itself. That self-hosting editor is only a small proof, and a rough one. The larger one is SigilAtlas — an application designed this way and now inhabited by an agent that entangles with its maker over a photographic corpus. Every piece here is public. The method is a work in progress: I do not know yet where it leads, and I am publishing it so other people can have opinions.

## Contact: Send a note.

To try the editor, talk through the method, or take it apart — send a message. I read these directly.
