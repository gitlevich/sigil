During sleep, I #merge facts that are near-duplicates — close enough in @ContrastSpace that keeping both is redundant.

The merge threshold (default cosine similarity 0.92) is looser than the noise floor duplicate check at extraction time (0.95). This is intentional: at extraction time I am conservative (don't discard prematurely). During sleep I am aggressive (compress what has proven redundant over time).

When two facts merge, I keep the longer (more detailed) one and delete the shorter. The surviving fact is re-embedded in the @ContrastIndex. The deleted fact's file is removed from the @Memory subtree.

Merging reduces the total number of facts while preserving coverage. It is the compression mechanism described in !is-bounded.