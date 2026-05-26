import type { RenameSigilResult } from "../../actions/workspace";

export type MutableRef<T> = { current: T };

export function recordCompletedRename(
  stackRef: MutableRef<RenameSigilResult[]>,
  result: RenameSigilResult | null,
  undoingRef: MutableRef<boolean>,
): void {
  if (result && !undoingRef.current) {
    stackRef.current.push(result);
  }
}

export function undoLastRename(
  stackRef: MutableRef<RenameSigilResult[]>,
  undoingRef: MutableRef<boolean>,
  rename: (targetPath: string, newName: string) => Promise<RenameSigilResult | null>,
): boolean {
  const lastRename = stackRef.current.pop();
  if (!lastRename) return false;

  void (async () => {
    undoingRef.current = true;
    try {
      const undone = await rename(lastRename.newPath, lastRename.oldName);
      if (!undone) stackRef.current.push(lastRename);
    } finally {
      undoingRef.current = false;
    }
  })();

  return true;
}
