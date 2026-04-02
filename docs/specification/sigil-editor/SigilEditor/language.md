---
status: implemented
---

# Sigil Editor

Sigil Editor is an application I am designing to write specs based on @sigils.

I #State-vision of the app in a dedicated place. I want it to be always one click away to remember the goal I pursue: I tend to get distracted easily.

I #Name-affordances: what should the app do for me. I try to be as precise as I can. I can always name them more precisely. And, I can always ask my @DesignPartner for naming advice.

I #Narrate to let domain language emerge. As I type, I #Notice-emergent-ontology — some words want to be their own @sigils. I recognize them and create them.

I narrate in a comfortable @Editor. As I type, the @OntologyTree on the left shows me the emerging structure. I #navigate to open any @sigil and make it the current focus. I can do this from @OntologyTree, @Atlas, or any surface that shows sigils — all views stay in sync. When I follow a link and want to retrace, I #back to the previously opened sigil — like browser back, a history stack. When a name no longer fits, I #rename and all references update.

Another way to visualize the emergent @sigil tree is via @Atlas: a tree map that flattens the @sigil tree into a 2D plane. This way I can see the structure: denser places, holes.

I #declare-invariants as I understand them, to make the boundaries of my @sigil explicitly defined. I care about !language-flow: awkward sentences are a symptom of poor structure. I care about !cognitive-simplicity: it is hard for me to handle more than a few concepts at once.

I #Distil-with-partner to get another point of view. I #Measure-coherence to track how close the language is to the vision. I #Import-external-ontology to use precise terms from an established domain without defining them locally. Once imported, every term in that ontology is available everywhere in my spec (!imported-ontology-in-scope).

I #Recognize-when-projectable to know when to hand the spec to an implementing agent. When ready, I #project: spec in, code out. The spec is the single source of truth — code is a projection.


## Static for SigilAtlas the application

I want a user that is not me opens this app and has an example in front of him to see how I did it and can follow, see what he likes, doesn’t and how he can benefit

### Invariants

- !cognitive-simplicity: it is hard for me to handle more than a few concepts at once and still attend to everything.
- !example-included: teach a new user thinking in @sigils to design an app, by having this spec open as example when the user first opens the app.
- !imported-ontology-in-scope: Every term in an imported ontology — the ontology name itself and all its descendants — is resolvable from anywhere in the spec. An imported ontology is omnipresent context, not locally scoped. If I #Import-external-ontology, every @sigil in that ontology becomes part of the domain language I can reference.
- !language-flow: how well the sentences in which i describe affordances in terms of sigils sound: awkward language is a symptom of poor model

### Affordances

- #Distil-with-partner: to get another point of view
- #Import-external-ontology: to use precise terms from an established external ontology that is useful in this context without defining them locally. this is a meta-affordance - to explicitly declare omnipresent context of an external domain language in scope.
- #Measure-coherence: to track how close the language is to the vision
- #Name-affordances: to declare what this sigil needs to do
- #Narrate: to let domain language emerge
- #Notice-emergent-ontology: to see which nouns need their own sigil
- #Recognize-when-projectable: to know when to hand it to an implementing agent
- #State-vision: to align design with a clear goal
- #access-ontology-library: I could use ontology library in other projects. I think of it separately. So Libs folder is mounted as a part of the application, not user’s application sigil. so when i unmount a sigil and mount another, or create a new one, i have Libs available alongside, sorted to appear under user’s app sigil.
- #toggle-dark-light-theme: because I want to switch. 
  
### Contained Sigils

- Atlas
- DesignPartner
- Editor
- OntologyTree

## VG Notes

to build domain language, we need words to express what an affordance like "distil with partner" actually means. You can do it in a couple of ways. We can model affordances in sigils, or on sigils, which leads to an object-oriented model, or you could model sigils in affordances. So it's this weird structure: sigil, affordances, expressed in sigils, expressed through affordances, and so forth. So I actually like the second one more; these affordances establish a polynomial-like articulation chain: the more members we have in each chain, the more precision we can articulate/resolve in the frame. "Articulate" is a time-like concept; "resolve" is space-like. They are equivalent. And are probably a kind of Fourier transform from each other

the UI-sounding @sigils, like @SigilEditor, are powered by my @attention. They are my surfaces of interaction with the @sigil I am envisioning and @DesignPartner that helps me with that.

the domain-model-sounding @sigils are powered by the @DesignPartner's @attention. @DesignPartner attends to (1) the other side of our interaction boundary and (2) the spells, narratives of how to do tedious deterministic things step by step, ignoring the structure, requiring that all attention is focused on following the steps. Things like run this tool, see what came back. Imperative things that lead to sure resutls if you execute them verbatim. That fall apart against non-deterministic situations. These spells are instructions @DesignPartner can execute, or write code to automate.

#publish, so that I can have this sigil repo pushed to GitHub, app re-projected under semantic versioning and released, and website re-published. Something like Cmd-Shift-S. And Cmd-S, which is to commit and push without release tag (no release, no publish)


!!!!!

i think we have invented an embodiment for AI: sigil is a fundamental attention structure, and this is a place to experience it. powered by any LLM but only locally persistent. as a single life.

!!!!!