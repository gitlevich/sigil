# Sigil Engineering

I have a vague vision of an application I want to build. I narrate the few things that I want to do. Those things are the reason why I want to build it. These are the affordances that it will give me. It's very imprecise. I'm writing sentences hoping to nail it down a little bit. The sentences constrain it a little more. I need more precise words. I define them. In the context of my application. 




Sigil Engineering
A method for specifying applications precisely enough to implement.

I have a vision of an application. I narrate what it does, from the outside in. To express that narrative, I need a few concepts — three to five. I define each one within a lexical scope: inside it, every word means exactly one thing.

Each concept has affordancesWhat the environment offers an organism for action — a relation between them, not a property of either alone. — what I can do with it — and boundaries that say what holds inside. Some of those concepts are not yet obvious, so I enter each one and repeat: narrate what it does, find the few concepts I need, define them. I stop when a concept is obvious from its name.

This thing I keep making — a named scope with affordancesWhat the environment offers an organism for action — a relation between them, not a property of either alone. and invariantsWhat a sigil enforces. Binds a preference to the sigil's boundary., that defines its own lexical scope because I need to define it precisely — I call it a sigilA lexical scope expressed in terms of its invariants (what constitutes the boundary) and its affordances (why you use it). Children introduce nested scopes..

An AI design partner drives convergence: generating phrases in my domain language, finding what the tree cannot yet express, checking that names fit and sibling concepts do not overlap.

The result is a tree of sigilsA lexical scope expressed in terms of its invariants (what constitutes the boundary) and its affordances (why you use it). Children introduce nested scopes.: the spec, the shared language, and the design.

Vision
I narrate what the finished system does. The vision is my acceptance test — the spec is complete when every part of it can be expressed using the concepts in the tree.

Always from the outside in. What does this thing affordWhat the environment offers an organism for action — a relation between them, not a property of either alone.? Not how it works — what it lets me do.

Sigil
A sigilA lexical scope expressed in terms of its invariants (what constitutes the boundary) and its affordances (why you use it). Children introduce nested scopes. is a named boundary. Inside it, I define the few concepts needed to express its affordancesWhat the environment offers an organism for action — a relation between them, not a property of either alone. — three to five. Each word means exactly one thing within this scope.

At every level, I only deal with a few concepts at once. The tree can go as deep as needed, but each level stays small.

Recursion
Some concepts are not yet obvious. I enter each one and define it the same way: a new scope, a few more words, each unambiguous within that boundary.

I descend until further decomposition would not add clarity. A door handle affordsWhat the environment offers an organism for action — a relation between them, not a property of either alone. opening the door — decomposing it further does not help.

Convergence
The AI design partner sees the entire tree. It generates phrases in my domain language and tries to express each one using the concepts I have defined. What it cannot express is a gap.

It also checks that each name means exactly what the concept does and that sibling concepts do not overlap. If an affordanceWhat the environment offers an organism for action — a relation between them, not a property of either alone. is hard to describe, the structure is wrong.

Result
The tree of sigilsA lexical scope expressed in terms of its invariants (what constitutes the boundary) and its affordances (why you use it). Children introduce nested scopes. is the spec — precise enough that a coding agentAn observer wearing a sigil. The sigil bounds what attention is allowed to care about here. can project it into working code. It is also the shared vocabulary between me, the AI partner, and the implementation. And it is the design.

Domain-agnostic. The domain language emerges from my narrationA sequence of frames compressed to a sequence of tokens. Lossy — ignores all but the contrasts the sigil deems relevant., not from a framework.

Worked example
This method was used to specify the tool that implements it.

Browse the spec — the worked example and the prompt for the Design Partner

Read the code — the working app, projected from that spec

Download the app — macOS editor for writing your own sigils

sigilengineering.com