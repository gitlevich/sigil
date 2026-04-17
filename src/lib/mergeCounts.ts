import * as Diff3 from "node-diff3";

/**
 * Three-way merge summary: how many hunks the merge resolved automatically
 * and how many collide. Fed to the notification surfaces of
 * #reconcile-external-changes.
 *
 *   mergedCount   — edit hunks the merge took without asking
 *   conflictCount — hunks where both sides diverged and I must decide
 */
export interface MergeCounts {
  mergedCount: number;
  conflictCount: number;
}

export function threeWayMergeCounts(mine: string, base: string, theirs: string): MergeCounts {
  const a = mine.split("\n");
  const o = base.split("\n");
  const b = theirs.split("\n");
  const regions = Diff3.diff3Merge(a, o, b);

  let merged = 0;
  let conflicts = 0;
  for (const region of regions) {
    if ("conflict" in region) {
      conflicts += 1;
      continue;
    }
    const ok = (region as { ok?: string[] }).ok;
    if (!ok) continue;
    // Pragmatic v1: if the ok region's lines don't appear as a contiguous slice
    // of base, the merge pulled them in from mine or theirs — count as merged.
    if (!isContiguousSliceOf(ok, o)) {
      merged += 1;
    }
  }
  return { mergedCount: merged, conflictCount: conflicts };
}

function isContiguousSliceOf(slice: string[], haystack: string[]): boolean {
  if (slice.length === 0) return true;
  for (let i = 0; i + slice.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < slice.length; j++) {
      if (haystack[i + j] !== slice[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
