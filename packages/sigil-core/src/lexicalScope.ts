/**
 * Lexical scope rules for sigil references.
 *
 * Implements invariant-lexical-scoping.md:
 *   1. children of S
 *   2. neighbors of S (same level)
 *   3. ancestors connecting S to root
 *   4. proximity: walk outward through enclosing subtrees, unique name wins
 *   5. imported ontologies at any depth
 *
 * Priority: child > sibling > ancestor > proximity > lib.
 * Ambiguity: multiple matches at the same level → does not resolve.
 */
import type { Sigil } from "./types";
import { findContext } from "./tree";
import { findChildrenByName, findDescendantsByName, nameMatches } from "./refs";

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

/** An entry in the scope: a name visible from the current position. */
export interface ScopeItem {
  kind: ScopeKind;
  name: string;
  target: Sigil;
  path: string[];
}

// ── Internal helpers ──

function findChild(parent: Sigil, name: string): Sigil | undefined {
  const matches = findChildrenByName(parent, name);
  return matches.length === 1 ? matches[0] : undefined;
}

function findChildrenAll(parent: Sigil, name: string): Sigil[] {
  return findChildrenByName(parent, name);
}

function findAllInSubtree(
  node: Sigil, name: string, basePath: string[],
): { target: Sigil; path: string[] }[] {
  const hits = findDescendantsByName(node, name);
  const results: { target: Sigil; path: string[] }[] = [];
  for (const hit of hits) {
    const fullPath = basePath.length === 0 ? hit.path : [...basePath, ...hit.path];
    results.push({ target: hit.target, path: fullPath });
  }
  return results;
}

/** Collect all nodes in a subtree, skipping already-seen names. */
function collectSubtree(
  node: Sigil, basePath: string[], seen: Set<string>,
): { name: string; target: Sigil; path: string[] }[] {
  const results: { name: string; target: Sigil; path: string[] }[] = [];
  for (const child of node.children) {
    const childPath = [...basePath, child.name];
    if (!seen.has(child.name)) {
      results.push({ name: child.name, target: child, path: childPath });
    }
    results.push(...collectSubtree(child, childPath, seen));
  }
  return results;
}

// ── Public API ──

/**
 * Is `name` in lexical scope from the sigil at `currentPath` within `root`?
 */
export function isInScope(
  root: Sigil, currentPath: string[], name: string, importedOntologies?: Sigil | null,
): boolean {
  const result = classify(root, currentPath, name, importedOntologies);
  return result !== null && !result.ambiguous;
}

/**
 * Resolve a reference like "@A" or "@A@B@C" from the given position.
 * Returns full resolution info including kind, path, and ambiguity.
 */
export function resolve(
  root: Sigil, currentPath: string[], refText: string, importedOntologies?: Sigil | null,
): ScopeResolution | null {
  const segments = refText.slice(1).split("@");
  if (segments.length === 0 || segments[0] === "") return null;

  const first = classify(root, currentPath, segments[0], importedOntologies);
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

/**
 * Build the complete lexical scope visible from `currentPath`.
 * Returns all in-scope names ordered by priority: children first, then
 * siblings, ancestors, proximity-reachable names, imported ontology terms.
 */
export function buildScope(
  root: Sigil, currentPath: string[], importedOntologies?: Sigil | null,
): ScopeItem[] {
  const items: ScopeItem[] = [];
  const seen = new Set<string>();

  const add = (name: string, target: Sigil, kind: ScopeKind, path: string[]) => {
    if (!seen.has(name)) {
      seen.add(name);
      items.push({ kind, name, target, path });
    }
  };

  const current = findContext(root, currentPath);

  // Rule 1: children
  for (const c of current.children) {
    add(c.name, c, "contained", [...currentPath, c.name]);
  }

  // Rule 2: neighbors
  if (currentPath.length > 0) {
    const parentPath = currentPath.slice(0, -1);
    const parent = findContext(root, parentPath);
    for (const c of parent.children) {
      if (c.name !== current.name) {
        add(c.name, c, "sibling", [...parentPath, c.name]);
      }
    }
  }

  // Rule 3: ancestors (self, parent, grandparent, ..., root)
  for (let i = currentPath.length - 1; i >= 0; i--) {
    const ancestorPath = currentPath.slice(0, i + 1);
    const ancestor = findContext(root, ancestorPath);
    add(ancestor.name, ancestor, "ancestor", ancestorPath);
  }
  add(root.name, root, "ancestor", []);

  // Rule 4: proximity — walk outward, collect unique names from each subtree level
  for (let depth = currentPath.length; depth >= 0; depth--) {
    const subtreeRoot = findContext(root, currentPath.slice(0, depth));
    const subtreePath = currentPath.slice(0, depth);
    const candidates = collectSubtree(subtreeRoot, subtreePath, seen);
    // Group by name to detect ambiguity at this level
    const byName = new Map<string, { target: Sigil; path: string[] }[]>();
    for (const c of candidates) {
      const existing = byName.get(c.name) ?? [];
      existing.push({ target: c.target, path: c.path });
      byName.set(c.name, existing);
    }
    for (const [name, matches] of byName) {
      if (matches.length === 1) {
        add(name, matches[0].target, "proximity", matches[0].path);
      }
      // Ambiguous names at this level are skipped — they don't enter scope
    }
  }

  // Rule 5: imported ontologies at any depth. They are ambient outer scope:
  // visible everywhere, but shadowed by any local definition.
  if (importedOntologies) {
    for (const ontology of importedOntologies.children) {
      const libItems = collectSubtree(ontology, [ontology.name], seen);
      add(ontology.name, ontology, "lib", [ontology.name]);
      for (const item of libItems) {
        add(item.name, item.target, "lib", item.path);
      }
    }
  }

  return items;
}

// ── Internal: classify a single name ──

function classify(
  root: Sigil, currentPath: string[], name: string, importedOntologies?: Sigil | null,
): ScopeResolution | null {
  const current = findContext(root, currentPath);

  // Rule 1: children
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

  // Rule 2: neighbors
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

  // Rule 3: ancestors
  for (let i = currentPath.length - 1; i >= 0; i--) {
    if (nameMatches(name, currentPath[i])) {
      const target = findContext(root, currentPath.slice(0, i + 1));
      return { kind: "ancestor", target, path: currentPath.slice(0, i + 1) };
    }
  }
  if (nameMatches(name, root.name)) return { kind: "ancestor", target: root, path: [] };

  // Rule 4: proximity
  for (let depth = currentPath.length; depth >= 0; depth--) {
    const subtreeRoot = findContext(root, currentPath.slice(0, depth));
    const subtreePath = currentPath.slice(0, depth);
    const matches = findAllInSubtree(subtreeRoot, name, subtreePath);
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

  // Rule 5: imported ontologies. They are ambient outer scope, so local
  // proximity matches eclipse same-named imported vocabulary.
  if (importedOntologies) {
    const libResults = findAllInSubtree(importedOntologies, name, []);
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

  return null;
}
