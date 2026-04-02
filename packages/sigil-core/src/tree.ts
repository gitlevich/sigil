import type { Context } from "./types";

export function findContext(root: Context, path: string[]): Context {
  let current = root;
  for (const seg of path) {
    const child = current.children.find((c) => c.name === seg);
    if (!child) return current;
    current = child;
  }
  return current;
}

export function buildBreadcrumb(
  root: Context,
  path: string[]
): { name: string; path: string[] }[] {
  const crumbs: { name: string; path: string[] }[] = [];
  let current = root;
  for (let i = 0; i < path.length; i++) {
    const child = current.children.find((c) => c.name === path[i]);
    if (!child) break;
    crumbs.push({ name: child.name, path: path.slice(0, i + 1) });
    current = child;
  }
  return crumbs;
}

/** Flatten the tree into a list of paths in visible (depth-first) order. */
export function flattenPaths(
  context: Context,
  path: string[]
): string[][] {
  const result: string[][] = [path];
  for (const child of context.children) {
    result.push(...flattenPaths(child, [...path, child.name]));
  }
  return result;
}

/** Find path from root to a context by name (DFS, case-insensitive). */
export function buildPath(
  ctx: Context,
  targetName: string,
  path: string[]
): string[] | null {
  for (const child of ctx.children) {
    const childPath = [...path, child.name];
    if (child.name.toLowerCase() === targetName.toLowerCase()) return childPath;
    const found = buildPath(child, targetName, childPath);
    if (found) return found;
  }
  return null;
}

/** Extract a short summary from domain_language (strips frontmatter, takes first 3 non-heading lines). */
export function makeSummary(ctx: Context): string {
  let text = ctx.domain_language || "";
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
    .slice(0, 3)
    .join("\n");
}
