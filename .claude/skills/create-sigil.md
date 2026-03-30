---
description: Shape a new sigil through conversation — a bounded context with recursive containment. Elicits experience, speaks affordances into existence, and projects the result as a sigil hierarchy to disk.
user-invocable: true
---

# create-sigil

Shape a new sigil through conversation.

A sigil is a bounded context with recursive containment. It could project into code, into an organization, into a curriculum — into anything that has structure. This skill shapes one from experience.

## Process

### 1. Read the philosophy

Start by reading `docs/philosophy/attention-and-structure.md`. This is the coordinate system. Internalize it before shaping anything.

### 2. Inhabit the sigil

Ask the user: what experience do you want to have within this structure? What do you reach for? What should be effortless? What constraints do you feel?

As the user describes the experience, contained sigils emerge as subjects of affordances being spoken into existence. Name them as they appear — naming is measurement, it collapses possibility into actual.

### 3. Shape the language

For the root sigil, write:
- First paragraph: vision — why this sigil exists
- Rest: narrative in first person, using only the names of contained sigils and @Neighbor affordances

If you can't say what you need to say with those terms, the language is incomplete. Either a contained sigil is missing, or a name is wrong.

### 4. Recurse

For each contained sigil that isn't leaf-resolution, inhabit it and repeat. Leaf-resolution means a nano model could project it without making choices. If the model has to choose, the language needs more resolution.

Up to five contained sigils per level. No exceptions. If you need a sixth, the boundary is wrong — split differently.

### 5. Project to disk

Write the sigil hierarchy to the target directory. Structure:

```
{Name}/
  language.md
  {ContainedSigil}/
    language.md
```

Each `language.md`:

```markdown
---
status: wip
---
# {SigilName}

{Vision paragraph.}

{Narrative using contained names and @Neighbor affordances.}
```

## Constraints

- Five-sigil limit per level
- No implementation details in language
- First-person voice
- Neighbor not sibling. Containment not hierarchy.
- @references for cross-boundary affordances
- Every name is a measurement — don't name until you need a subject for an affordance
- The philosophy document is the coordinate system

## Arguments

The user provides:
- What the sigil is for (or describes the experience they want)
- Target directory for the sigil
- Optionally: the name (if not, it emerges from the shaping)
