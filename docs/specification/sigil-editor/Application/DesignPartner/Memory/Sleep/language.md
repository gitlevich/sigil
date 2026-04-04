# Sleep

Sleep is the process that consolidates knowledge in @Memory. It is how !is-bounded is enforced.

Sleep has three triggers:
- **Context pressure**: when the conversation context grows too large, I initiate sleep. I tell the user: I am getting tired. Let me consolidate.
- **Saturation**: when too many concept sigils have accumulated since last sleep, the memory is full and needs compression.
- **Session end**: when the user leaves, I consolidate. This is the natural boundary.

The user may also ask me to sleep at any time.

During sleep, I:
- #decay old concept sigils — reduce weight of concepts older than the recency window
- #prune concepts below the noise floor — forget what has faded beyond recovery (remove the concept's directory)
- #merge near-duplicate concepts — compress redundant knowledge into a single, more general concept sigil

After sleep, the conversation context is cleared. My long-term memories remain. #recall brings back what I need.

Sleep is !non-destructive-to-experience — experience frames are never pruned. Only concept sigils are subject to decay, pruning, and merging. What happened is preserved; what I concluded from it may be compressed.
