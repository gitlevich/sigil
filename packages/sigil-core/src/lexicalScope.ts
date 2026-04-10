/**
 * Lexical scope rules for sigil references.
 *
 * Implements invariant-lexical-scoping.md:
 *   1. children of S
 *   2. neighbors of S (same level)
 *   3. ancestors connecting S to root
 *   4. imported ontologies at any depth
 *   5. proximity: walk outward through enclosing subtrees, unique name wins
 *
 * Priority: child > sibling > ancestor > lib > proximity.
 * Ambiguity: multiple matches at the same level → does not resolve.
 */
import type { Sigil } from "./types";
import { findContext } from "./tree";
import { resolveRefName, resolveRefNameAll } from "./refs";

export type ScopeKind = "contained" | "sibling" | "ancestor" | "lib" | "proximity" | "unresolved";

export interface ScopeResolution {
  kind: ScopeKind;
  target: Sigil;
  /** Path from root to the resolved sigil (not including root name). */
  path: string[];
  /** True when multiple candidates exist at the same scope level. */
  ambiguous?: boolean;
  /** When ambiguous, the candidate locations for the user to disambiguate. */
  candidates?: { name: string; path: string[] }[];
}

/** Find a child by name with fuzzy matching. Returns undefined if no match or ambiguous. */
function findChild(parent: Sigil, name: string): Sigil | undefined {
  const matches = resolveRefNameAll(name, parent.children.map(c => c.name));
  if (matches.length !== 1) return undefined;
  return parent.children.find(c => c.name === matches[0]);
}

/** Find all children that fuzzy-match, for ambiguity reporting. */
function findChildrenAll(parent: Sigil, name: string): Sigil[] {
  const matches = resolveRefNameAll(name, parent.children.map(c => c.name));
  return matches.map(m => parent.children.find(c => c.name === m)!);
}

/** Check if name fuzzy-matches a known name. */
function nameMatches(name: string, candidate: string): boolean {
  return resolveRefName(name, [candidate]) !== undefined;
}

/** Collect all fuzzy matches in a subtree, excluding nodes already found by tighter rules. */
function findAllInSubtree(
  node: Sigil,
  name: string,
  basePath: string[],
  exclude: Set<string>,
): { target: Sigil; path: string[] }[] {
  const results: { target: Sigil; path: string[] }[] = [];
  for (const child of node.children) {
    const childPath = [...basePath, child.name];
    const pathKey = childPath.join("/");
    if (!exclude.has(pathKey) && nameMatches(name, child.name)) {
      results.push({ target: child, path: childPath });
    }
    results.push(...findAllInSubtree(child, name, childPath, exclude));
  }
  return results;
}

/**
 * Is `name` in lexical scope from the sigil at `currentPath` within `root`?
 */
export function isInScope(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): boolean {
  const result = classifyName(root, currentPath, name, importedOntologies);
  return result !== null && !result.ambiguous;
}

/**
 * Classify how `name` relates to the current scope.
 * Returns null if not in scope. Returns ambiguous result if multiple candidates at same level.
 */
function classifyName(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): ScopeResolution | null {
  const current = findContext(root, currentPath);

  // Rule 1: children (innermost)
  const childMatches = findChildrenAll(current, name);
  if (childMatches.length === 1) {
    return { kind: "contained", target: childMatches[0], path: [...currentPath, childMatches[0].name] };
  }
  if (childMatches.length > 1) {
    return {
      kind: "contained", target: childMatches[0], path: [...currentPath, childMatches[0].name],
      ambiguous: true,
      candidates: childMatches.map(c => ({ name: c.name, path: [...currentPath, c.name] })),
    };
  }

  // Rule 2: neighbors (parent's children at same level)
  if (currentPath.length > 0) {
    const parentPath = currentPath.slice(0, -1);
    const parent = findContext(root, parentPath);
    const siblingMatches = findChildrenAll(parent, name).filter(c => c.name !== current.name);
    if (siblingMatches.length === 1) {
      return { kind: "sibling", target: siblingMatches[0], path: [...parentPath, siblingMatches[0].name] };
    }
    if (siblingMatches.length > 1) {
      return {
        kind: "sibling", target: siblingMatches[0], path: [...parentPath, siblingMatches[0].name],
        ambiguous: true,
        candidates: siblingMatches.map(c => ({ name: c.name, path: [...parentPath, c.name] })),
      };
    }
  }

  // Rule 3: self and ancestors on the path to root
  for (let i = currentPath.length - 1; i >= 0; i--) {
    if (nameMatches(name, currentPath[i])) {
      const target = findContext(root, currentPath.slice(0, i + 1));
      return { kind: "ancestor", target, path: currentPath.slice(0, i + 1) };
    }
  }
  if (nameMatches(name, root.name)) return { kind: "ancestor", target: root, path: [] };

  // Rule 4: imported ontologies at any depth
  if (importedOntologies) {
    const libResults = findAllInSubtree(importedOntologies, name, [], new Set());
    if (libResults.length === 1) {
      return { kind: "lib", target: libResults[0].target, path: libResults[0].path };
    }
    if (libResults.length > 1) {
      return {
        kind: "lib", target: libResults[0].target, path: libResults[0].path,
        ambiguous: true,
        candidates: libResults.map(r => ({ name: r.target.name, path: r.path })),
      };
    }
  }

  // Rule 5: proximity — walk outward through enclosing subtrees
  // Collect paths already covered by rules 1-3 to avoid double-counting
  const alreadyCovered = new Set<string>();
  for (const child of current.children) alreadyCovered.add([...currentPath, child.name].join("/"));
  if (currentPath.length > 0) {
    const parent = findContext(root, currentPath.slice(0, -1));
    for (const child of parent.children) alreadyCovered.add([...currentPath.slice(0, -1), child.name].join("/"));
  }
  for (let i = 0; i <= currentPath.length; i++) alreadyCovered.add(currentPath.slice(0, i).join("/"));

  // Walk outward: own subtree, parent's subtree, grandparent's, ..., root
  for (let depth = currentPath.length; depth >= 0; depth--) {
    const subtreeRoot = findContext(root, currentPath.slice(0, depth));
    const subtreePath = currentPath.slice(0, depth);
    const matches = findAllInSubtree(subtreeRoot, name, subtreePath, alreadyCovered);
    if (matches.length === 1) {
      return { kind: "proximity", target: matches[0].target, path: matches[0].path };
    }
    if (matches.length > 1) {
      return {
        kind: "proximity", target: matches[0].target, path: matches[0].path,
        ambiguous: true,
        candidates: matches.map(r => ({ name: r.target.name, path: r.path })),
      };
    }
  }

  return null;
}

/**
 * Resolve a reference like "@A" or "@A@B@C" from the given position.
 * First segment must be in lexical scope. Each subsequent segment
 * walks into children of the resolved sigil.
 */
export function resolveRef(
  root: Sigil,
  currentPath: string[],
  refText: string,
  importedOntologies?: Sigil | null,
): Sigil | null {
  const result = resolveRefFull(root, currentPath, refText, importedOntologies);
  return result && !result.ambiguous ? result.target : null;
}

/**
 * Like resolveRef but returns full resolution info including kind, path, and ambiguity.
 */
export function resolveRefFull(
  root: Sigil,
  currentPath: string[],
  refText: string,
  importedOntologies?: Sigil | null,
): ScopeResolution | null {
  const segments = refText.slice(1).split("@");
  if (segments.length === 0 || segments[0] === "") return null;

  const first = classifyName(root, currentPath, segments[0], importedOntologies);
  if (!first) return null;
  if (first.ambiguous) return first;

  let target = first.target;
  const path = [...first.path];

  for (let i = 1; i < segments.length; i++) {
    const child = findChild(target, segments[i]);
    if (!child) return null;
    target = child;
    path.push(child.name);
  }

  return { kind: first.kind, target, path };
}
