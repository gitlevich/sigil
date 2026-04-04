During sleep, I #prune facts whose weight has fallen below the noise floor (default 0.1).

Pruning deletes the fact file from the @Memory subtree and removes its entry from the @ContrastIndex. The fact is forgotten — no longer present in my recall. The @Experience frames that gave rise to the fact are not affected; they remain as historical record.

Pruning is how !is-bounded is enforced concretely. Without pruning, facts accumulate monotonically. With pruning, only facts that have maintained their weight — by recurrence, by recency, or by being reinforced — survive.