import type { Sigil } from "./types";
import { findContext } from "./tree";
import { resolveRefName } from "./refs";

export type ScopeKind = "contained" | "sibling" | "ancestor" | "lib" | "unresolved";

export interface ScopeResolution {
  kind: ScopeKind;
  target: Sigil;
  /** Path from root to the resolved sigil (not including root name). */
  path: string[];
}

/** Find a child by name with fuzzy matching (case, dashes, plurals). */
function findChild(parent: Sigil, name: string): Sigil | undefined {
  const canonical = resolveRefName(name, parent.children.map(c => c.name));
  return canonical ? parent.children.find(c => c.name === canonical) : undefined;
}

/** Check if name fuzzy-matches a known name. */
function nameMatches(name: string, candidate: string): boolean {
  return resolveRefName(name, [candidate]) !== undefined;
}

/**
 * Is `name` in lexical scope from the sigil at `currentPath` within `root`?
 *
 * Spec (invariant-lexical-scoping.md):
 *   1. children of S
 *   2. neighbors of S (same level in the hierarchy)
 *   3. sigils connecting S to the root (ancestors on the path, including self and root)
 *   4. sigils in imported ontologies regardless of their level
 *
 * Descendants beyond children require a relative path (see resolveRef).
 */
export function isInScope(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): boolean {
  return classifyName(root, currentPath, name, importedOntologies) !== null;
}

/**
 * Classify how `name` relates to the current scope. Returns null if not in scope.
 */
function classifyName(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): { kind: ScopeKind; target: Sigil; path: string[] } | null {
  const current = findContext(root, currentPath);

  // Rule 1: children (innermost)
  const child = findChild(current, name);
  if (child) return { kind: "contained", target: child, path: [...currentPath, child.name] };

  // Rule 2: neighbors (parent's children at same level)
  if (currentPath.length > 0) {
    const parentPath = currentPath.slice(0, -1);
    const parent = findContext(root, parentPath);
    const sibling = findChild(parent, name);
    if (sibling) return { kind: "sibling", target: sibling, path: [...parentPath, sibling.name] };
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
    const result = findInTreeFuzzy(importedOntologies, name, []);
    if (result) return { kind: "lib", target: result.target, path: result.path };
  }

  return null;
}

/**
 * Resolve a reference like "@A" or "@A@B@C" from the given position.
 *
 * First segment must be in lexical scope. Each subsequent segment
 * walks into children of the resolved sigil. Returns null if unresolvable.
 */
export function resolveRef(
  root: Sigil,
  currentPath: string[],
  refText: string,
  importedOntologies?: Sigil | null,
): Sigil | null {
  const result = resolveRefFull(root, currentPath, refText, importedOntologies);
  return result ? result.target : null;
}

/**
 * Like resolveRef but returns full resolution info including kind and path.
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

/** Recursively search a tree for a sigil by fuzzy name, tracking path. */
function findInTreeFuzzy(
  node: Sigil,
  name: string,
  currentPath: string[],
): { target: Sigil; path: string[] } | null {
  for (const child of node.children) {
    const childPath = [...currentPath, child.name];
    if (nameMatches(name, child.name)) return { target: child, path: childPath };
    const found = findInTreeFuzzy(child, name, childPath);
    if (found) return found;
  }
  return null;
}
