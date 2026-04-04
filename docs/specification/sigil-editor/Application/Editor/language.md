---
status: implemented
---

# Editor

```
*** P O I N T    O F   V I E W ***
*                                *
*     Mine. I am the @User.      *
*                                *
*** -------------------------- ***
```

This is where I live, narrating in comfort. This @sigil is mostly occupied by my attention. Sometimes @DesignPartner comes over to @DesignPartner#chat.

As I type, @OntologyTree on the left shows me the emerging structure. 

@Atlas is in another way to see the structure, from above. It's a tree map that flattens the @sigil tree into a 2D plane. 

I #navigate @OntologyTree, @atlas to a @sigil and click it once to open. All views sync up. I follow a link and want to retrace, I #back to the previously opened sigil — like browser back, a history stack. When a name no longer fits, I #rename and all references update.


I #declare-invariants as I understand them, to make the boundaries of my @sigil explicitly defined. I care about !language-flow: awkward sentences are a symptom of poor structure. I care about !cognitive-simplicity: it is hard for me to handle more than a few concepts at once.

I #distil-with-partner to get another point of view. I #Measure-coherence to track how close the language is to the @vision. I #Import-external-ontology to use precise terms from an established domain without defining them locally. Once imported, every term in that ontology is available everywhere in my spec (!imported-ontology-in-scope).

I #recognize-when-projectable to know when to hand the spec to an implementing agent. When ready, I #project: spec in, code out. The spec is the single source of truth — code is a projection.


## Static for SigilAtlas the application

I want a user other than me that is not me opens this app and has an example in front of him to see how I did it and can follow, see what he likes, doesn’t and how he can benefit

### Invariants

- !cognitive-simplicity: it is hard for me to handle more than a few concepts at once and still attend to everything.
- !example-included: teach a new user thinking in @sigils to design an app, by having this spec open as example when the user first opens the app.
- !imported-ontology-in-scope: Every term in an imported ontology — the ontology name itself and all its descendants — is resolvable from anywhere in the spec. An imported ontology is omnipresent context, not locally scoped. If I #Import-external-ontology, every @sigil in that ontology becomes part of the domain language I can reference.
- !language-flow: how well the sentences in which i describe affordances in terms of sigils sound: awkward language is a symptom of poor model

### Affordances

- #Distil-with-partner: to get another point of view
- #Measure-coherence: to track how close the language is to the @vision
- #name-affordances: to declare what this sigil needs to do
- #Narrate: to let domain language emerge
- #Notice-emergent-ontology: to see which nouns need their own sigil
- #Recognize-when-projectable: to know when to hand it to an implementing agent
- #state-my-vision: to align design with a clear goal
- #toggle-dark-light-theme: because I want to switch.
  
## VG Notes - WIP

to build domain language, I need words to express what an affordance like "distil with partner" actually means. I can model affordances in sigils, which leads to an object-oriented model, or I could model sigils in affordances. So it's this weird structure: sigil with affordances expressed in sigils expressed in affordances, all the way down. I think I prefer the second one. Affordances establish a polynomial-like articulation chain: the more members we have in each chain, the more precision I can articulate/resolve in the frame. "Articulate" is a time-like concept; "resolve" is space-like. They are equivalent. And are probably a kind of Fourier transform from each other


#publish, so that I can have this sigil repo pushed to GitHub, app re-projected under semantic versioning and released, and website re-published. Something like Cmd-Shift-S. And Cmd-S, which is to commit and push without release tag (no release, no publish)

All affordances conceptually belong not to me or to my @DesignPartner, but to UI boundaries like SigilEditor through which we entangle. These boundaries expose @affordances to both of us. And @DesignPartner exposes affordances to me.


