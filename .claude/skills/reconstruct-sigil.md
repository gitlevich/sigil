---
description: Reconstruct a sigil from spells — narrative paths traced through an unknown structure. Given conversations, documents, or any collection of narratives, infer the shape they outline and project it as a sigil hierarchy.
user-invocable: true
---

# reconstruct-sigil

Reconstruct a sigil from spells.

A spell is a narrative that traces one path through a structure. It names things, uses affordances, crosses boundaries — but linearly, the way a story does. The structure is implicit in the telling.

Given a collection of spells, find the shape they outline. Which names recur — those are sigils. Which names appear together — that's containment. Which names reference each other across boundaries — those are neighbor relationships. Which contrasts keep surfacing — those are the dimensions that matter for this region in embedding space.

## Process

### 1. Read the philosophy

Start by reading `docs/philosophy/attention-and-structure.md`. This is the densest expression of the shape — the coordinate system in which all sigils live. Internalize it before touching any spells. Key concepts that govern reconstruction:

- A sigil is a bounded context with recursive containment
- A sigil's language IS the sigil. First paragraph is vision (why it exists). Rest is narrative using names of contained sigils and neighbor affordances
- Naming is measurement — collapses possibility into actual
- Contained sigils emerge as subjects of affordances being spoken into existence
- The five-sigil limit forces compression that produces meaning
- No implementation leakage in domain language — no files, panels, editors, buttons
- First-person voice
- @references for neighbors and their affordances
- `language.md` at every level, nothing else

### 2. Search the spells

DO NOT read spell files linearly — they are too large. Use semantic search (mcp__project-embed__search or mcp__thought-index__search_thoughts) to find paths through the structure.

Search strategy:
- Start with the contrasts that matter: what dimensions keep appearing across spells?
- Search for recurring names — these are candidate sigils
- Search for co-occurrence — which names appear together? That's containment
- Search for boundary crossings — where does one concept reference another? That's neighbor relationships
- Search for affordances — what can be addressed from outside each boundary?

Each search result is a fragment of a spell — one segment of one path through the structure. Enough fragments and the shape resolves.

### 3. Triangulate the shape

From the search results, infer:
- The root sigil: what is this structure FOR? (vision = first paragraph)
- The top-level contained sigils: up to five. These are the contrasts that recur most strongly across spells.
- For each contained sigil: what is IT for? What does it contain? What affordances does it expose to neighbors?
- Recurse until leaves have sufficient resolution for projection

Sufficient resolution means: a nano model could project this leaf into code (or whatever the target medium is) without making choices. If the model has to choose, the language is incomplete.

### 4. Project to disk

Write the sigil hierarchy to the target directory. Structure:

```
{Name}/
  language.md
  {ContainedSigil1}/
    language.md
    {Leaf1}/
      language.md
    {Leaf2}/
      language.md
  {ContainedSigil2}/
    language.md
```

Each `language.md` follows this format:

```markdown
---
status: wip
---
# {SigilName}

{Vision paragraph — why this sigil exists, what it's for.}

{Narrative — sentences written in first person, using the names of contained sigils and @Neighbor affordances. If I can't say what I need to say with those terms, the language is incomplete.}
```

### 5. Verify

After writing, traverse the structure:
- Forward: does each level build cleanly from its children?
- Backward: does each child integrate cleanly into its parent?
- Across: are neighbor boundaries sharp? Can I tell where one sigil ends and another begins?

If the shape builds in one direction but doesn't integrate in the other, it's not finished. The two traversals are the two halves of the spinor rotation — both needed for full understanding.

## Constraints

- Five-sigil limit per level. No exceptions.
- No implementation details in language. No files, no functions, no UI elements.
- First-person voice throughout.
- Neighbor not sibling. Containment not hierarchy.
- @references for cross-boundary affordances: `@Neighbor.affordance`
- Every name is a measurement — don't name something until you need it as a subject for an affordance.
- The philosophy document is the coordinate system. The spells are projections. The sigil is the shape being reconstructed.

## Arguments

The user provides:
- Source of spells (directory, file pattern, or description of where to search)
- Target directory for the reconstructed sigil
- Optionally: the name of the sigil to reconstruct (if not obvious from the spells)
