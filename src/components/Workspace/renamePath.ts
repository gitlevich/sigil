import type { RenameSigilResult } from "../../actions/workspace";

function normalizeFsPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function currentPathAfterRename(
  currentPath: string[],
  currentFolderPath: string | null | undefined,
  result: RenameSigilResult | null,
): string[] | null {
  if (!currentFolderPath || !result) return null;

  const selectedFsPath = normalizeFsPath(currentFolderPath);
  const oldFsPath = normalizeFsPath(result.oldPath);
  if (!isSameOrDescendant(selectedFsPath, oldFsPath)) return null;

  const suffix = selectedFsPath
    .slice(oldFsPath.length)
    .split("/")
    .filter(Boolean);
  const targetIndex = currentPath.length - suffix.length - 1;
  if (targetIndex < 0) return null;

  const nextPath = [...currentPath];
  nextPath[targetIndex] = result.newName;
  return nextPath;
}
