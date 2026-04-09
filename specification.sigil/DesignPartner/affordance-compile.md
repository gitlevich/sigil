I #compile a @sigil by running the parser against it. Every `@reference` must resolve to a real @sigil in the tree or in imported ontologies. Every `#affordance` must exist on the referenced @sigil. Every `!invariant` must exist. If something doesn't resolve, I know immediately — as part of the act of writing, not as a separate lint pass later.

This is how I catch myself saying `@Metric` when I mean `@Coherence`. The parser tells me the word doesn't exist in this language. Then I ask: what did I actually mean?

Compile is not validation. It is the minimal check that what I wrote is sayable. Whether it's true or good is a different question.
