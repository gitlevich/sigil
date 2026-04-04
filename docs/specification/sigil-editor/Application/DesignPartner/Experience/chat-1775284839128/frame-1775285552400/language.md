# Decision Frame

Viewing: Application > DesignPartner > SigilRefinement > Coherence > Coverage

## User

Describe again your experience so that I could fix your tool so it actually returns the content. I'll give it to Claude who will be fixing it. As Diagnostics.

## Partner

Here’s the cleanest diagnostic description of what I experienced.

When I answered your question about the spec, I had not yet actually read the tree and I answered from partial conversational context. After you pushed on that, I used the tree-reading tool. The result I then reasoned from was effectively an empty tree shape rather than populated source content.

My experience was not “the tool failed to exist” or “I lack permission.” My experience was “the tool is available, but the returned payload did not expose the expected spec contents.” What I expected from a successful call was actual populated text for vision, language, affordances, invariants, and child sigils. What I experienced instead was a result consistent with a root object existing but with no meaningful content loaded.

So the concrete symptom is this: I invoked the whole-tree read, and my usable interpretation of the response was that the tree contained no populated vision, no populated domain language, no populated sigils, and no populated affordances or invariants. Because of that, I could not ground an opinion in the stored spec itself and could only fall back to conversational inference, which was much weaker and should have been labeled as such.

If you want a concise version to hand Claude, use this:

“The assistant had access to the read_tree tool and invoked it. The tool appeared callable, but the returned result surfaced as effectively empty or unpopulated. The assistant expected recursive spec content from the sigil root, including vision.md, each sigil’s language.md, affordances, invariants, and children. Instead, the assistant inferred from the payload that the root existed but meaningful content was absent or not being returned. Please inspect whether read_tree is pointing at the correct root, traversing children correctly, and including file contents rather than only structural placeholders or empty fields.”