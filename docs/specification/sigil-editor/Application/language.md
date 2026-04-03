---
status: implemented
---

# Application

**NOTE: this is still work in progress**

**Sigil** is an tool to help me speak an application I am envisioning into a specification that a coding agent will project into beautifully written code.

I #state-my-vision in @Vision. I want it to be one click away as a counter-measure to shiny things that distract me. To refocus.

I #name-affordances: what should the app do for me. I try to find words that communicate my intent. It's ok if I can't find a good name: it will emerge later. And, I can always ask my @DesignPartner for naming advice.

I #narrate how these @affordances work to let the right words emerge. As I type, I #notice-emergent-ontology — some words feel important. Using a word in a sentence makes it meaning clearer. 

To fix the meaning, I define a word. To avoid overwhelm, I let myself enter the concept the word stands for, at the next level of abstraction down. I leet the word fill my @frame and describe what I see. If the words I use for description still feel imprecise, I repeat. Turtles all the way down, until at the last level of abstraction the words are unambiguous. Then I stop.

I call this structure a @sigil: the boundary of a lexical scope, contained in a lexical scope, containing lexical scopes. Think of it as a tree in which each node contains its children, and no root. 

I narrate in a comfortable @Editor. As I type, the @OntologyTree on the left shows me the emerging structure. I #navigate to open any @sigil and make it the current focus. I can do this from @OntologyTree, @Atlas, or any surface that shows sigils — all views stay in sync. When I follow a link and want to retrace, I #back to the previously opened sigil — like browser back, a history stack. When a name no longer fits, I #rename and all references update.

Another way to visualize the emergent @sigil tree is via @Atlas: a tree map that flattens the @sigil tree into a 2D plane. This way I can see the structure: denser places, holes.

I #declare-invariants as I understand them, to make the boundaries of my @sigil explicitly defined. I care about !language-flow: awkward sentences are a symptom of poor structure. I care about !cognitive-simplicity: it is hard for me to handle more than a few concepts at once.

I #Distil-with-partner to get another point of view. I #Measure-coherence to track how close the language is to the @vision. I #Import-external-ontology to use precise terms from an established domain without defining them locally. Once imported, every term in that ontology is available everywhere in my spec (!imported-ontology-in-scope).

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
- #Measure-coherence: to track how close the language is to the @vision
- #name-affordances: to declare what this sigil needs to do
- #Narrate: to let domain language emerge
- #Notice-emergent-ontology: to see which nouns need their own sigil
- #Recognize-when-projectable: to know when to hand it to an implementing agent
- #state-my-vision: to align design with a clear goal
- #access-ontology-library: I could use ontology library in other projects. I think of it separately. So Libs folder is mounted as a part of the application, not user’s application sigil. so when i unmount a sigil and mount another, or create a new one, i have Libs available alongside, sorted to appear under user’s app sigil.
- #toggle-dark-light-theme: because I want to switch. 
  

