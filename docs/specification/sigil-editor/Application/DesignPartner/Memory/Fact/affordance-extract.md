After each conversation turn, the #memorize process calls an LLM to #extract facts from the exchange.

The extraction prompt asks for 0-5 atomic facts worth remembering. Rules:
- Each fact is a single self-contained statement.
- Skip transient details (tool use, formatting, navigation).
- Include: design decisions, user preferences, domain knowledge, structural insights, corrections.
- If nothing is worth extracting, extract nothing.

Each extracted fact is checked for near-duplicates against existing facts in @ContrastSpace. If the nearest neighbor exceeds the noise floor similarity threshold, the fact is discarded.

Facts that survive are written as `fact-{id}.md` in the @Memory subtree and immediately indexed in the @ContrastIndex.