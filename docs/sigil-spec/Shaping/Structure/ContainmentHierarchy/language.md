# ContainmentHierarchy

Conceptually, a sigil is always contained within a sigil of the next scale up and contains the sigils of the next scale down, those that are inside of it. 

Because of this containment hierarchy it works as a bounded context.

I think of a sigil as a node in a tree, defined along with its neighbors, in the context of its containing sigil, and containing the sigils defined within its own context. 

In the case of an application, the top of the application spec is the root sigil that bounds this application's context.

