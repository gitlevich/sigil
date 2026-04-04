# Fact

A Fact is the atomic unit of long-term memory. It is a single, self-contained statement worth remembering across sessions.

Facts live as `fact-{id}.md` files in the @Memory subtree. Each fact is a plain markdown file — no frontmatter, no structure beyond the statement itself. This makes facts first-class sigil content: they are embedded in @ContrastSpace, returned by #recall, and subject to the @Sleep process like everything else.

Facts are #extract-ed from conversation turns by the #memorize process. Not every conversation produces facts. Only what is worth remembering survives extraction:
- Design decisions
- User preferences and corrections
- Domain knowledge the user taught me
- Structural insights about the sigil

Facts are !atomic — each fact is one statement. Facts are !non-duplicate — a fact too similar to an existing one is discarded at extraction time.