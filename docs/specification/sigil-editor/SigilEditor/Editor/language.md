---
status: idea
---

# Editor

The editor panel is where I define the part of my application this @sigil represents. 

The sigil exists because it lets me do things (provides affordances) and gives me the context to define more precise terms, to express these affordances. 

An **affordance** on a sigil is like a handle on a door: it is the thing that allows me to open it. 

A @sigil gives me a context boundary: within, I only care about a finite number of specific relevant things. These things are also @sigils that live either inside the boundary, or in the neighborhood.  Everything not explicitly named is noise. 

The boundary is defined in terms of my disposition towards these @sigils. For example here I care about @sigils that will make my experience while using this part of the app delightful.

To describe a sigil, I imagine interacting with the part of the app it models. I inhabit it with my attention and narrate what I do there, trying to converge on a stable language. I first think of affordances. 

As I type, I notice the words I choose to describe affordances. I can use names of the neighboring @sigils for the affordances they provide or could provide. When I need new @sigils to express an affordance, I define them in the context of the current @sigil. I want smooth, flowing language. I watch out for awkward language as it indicates a modeling problem: good models flow. I don't worry about defining the newly defined @sigil's structure: I will do it when I inhabit it, at the right level of abstraction. 


## Structure

The Editor consists of three panels: affordance, language and disposition.

### @AffordancePanel

This is where I specify affordances. 

### @LanguagePanel

This is the main panel where I type the narrative

### @DispositionPanel

This is where I specify dispositions. 




## Refactoring 

To have the freedom to evolve my language, I need #refactor-rename. 

I'd like to #find-references of a sigil - to see where it's used. FileFileMy