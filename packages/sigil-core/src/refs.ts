import type { Affordance, Sigil } from "./types";
import { findContext, makeSummary } from "./tree";

export interface Ref {
  name: string;
  prefix: "@" | "#" | "!";
  summary: string;
  navigable: boolean;
  /** For affordances/invariants inherited from an ancestor, the owning sigil name to navigate to. */
  navigateTo?: string;
}

/** Strip spaces, dashes, underscores and lowercase — for fuzzy sigil name matching. */
export function flattenName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Convert dash-separated #reference back to original affordance name. */
export function fromDashForm(dashed: string): string {
  return dashed.replace(/-/g, " ");
}

/** Build an index mapping lowercased and flattened names to canonical names. */
export function buildNameIndex(names: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const n of names) {
    index.set(n.toLowerCase(), n);
    index.set(flattenName(n), n);
  }
  return index;
}

/** Resolve a (possibly inflected) ref name to the canonical name, or undefined if unknown. */
export function resolveRefName(refName: string, knownNames: string[]): string | undefined {
  const lower = refName.toLowerCase();
  let match = knownNames.find((n) => n.toLowerCase() === lower);
  if (match) return match;

  const flat = flattenName(refName);
  match = knownNames.find((n) => flattenName(n) === flat);
  if (match) return match;

  // Plurals: -ies → -y
  if (lower.endsWith("ies") && lower.length > 3) {
    const stem = lower.slice(0, -3) + "y";
    match = knownNames.find((n) => n.toLowerCase() === stem);
    if (match) return match;
  }

  // Plurals: -s
  if (lower.endsWith("s") && lower.length > 1) {
    const stem = lower.slice(0, -1);
    match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
    if (match) return match;
  }

  // Past tense: -ed (collapsed → collapse, attended → attend)
  if (lower.endsWith("ed") && lower.length > 3) {
    const stems = [lower.slice(0, -2), lower.slice(0, -1)];
    for (const stem of stems) {
      match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
      if (match) return match;
    }
  }

  // Present continuous: -ing (collapsing → collapse, attending → attend)
  if (lower.endsWith("ing") && lower.length > 4) {
    const stems = [lower.slice(0, -3), lower.slice(0, -3) + "e"];
    for (const stem of stems) {
      match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
      if (match) return match;
    }
  }

  return undefined;
}

/** Find an affordance by its dash-form name, with fuzzy matching. */
export function findAffordance(sigil: Sigil | undefined, dashedName: string): Affordance | undefined {
  if (!sigil?.affordances) return undefined;
  const spacedName = fromDashForm(dashedName);
  const exact = sigil.affordances.find((a) => a.name === spacedName || a.name === dashedName);
  if (exact) return exact;
  const names = sigil.affordances.map((a) => a.name);
  const resolved = resolveRefName(dashedName, names);
  return resolved ? sigil.affordances.find((a) => a.name === resolved) : undefined;
}

/** Find an invariant by name, returning its content and owning path. */
function findInvariantOn(sigil: Sigil, path: string[], name: string): { content: string; ownerPath: string[] } | null {
  const dashed = fromDashForm(name);
  let inv = sigil.invariants.find((s) => s.name === name || s.name === dashed);
  if (!inv) {
    const resolved = resolveRefName(name, sigil.invariants.map((s) => s.name));
    if (resolved) inv = sigil.invariants.find((s) => s.name === resolved);
  }
  return inv ? { content: inv.content, ownerPath: path } : null;
}

/** Find an invariant in lexical scope: self, children, siblings, ancestors (each with their children one level deep). */
export function findInvariantInScope(
  root: Sigil,
  currentPath: string[],
  name: string
): { content: string; ownerPath: string[] } | null {
  const currentSigil = findContext(root, currentPath);

  // Current sigil
  const own = findInvariantOn(currentSigil, currentPath, name);
  if (own) return own;

  // Children
  for (const child of currentSigil.children) {
    const result = findInvariantOn(child, [...currentPath, child.name], name);
    if (result) return result;
  }

  // Walk up: each ancestor and its children (one level deep) — includes siblings
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    const result = findInvariantOn(levelSigil, levelPath, name);
    if (result) return result;
    for (const child of levelSigil.children) {
      const childPath = [...levelPath, child.name];
      const childResult = findInvariantOn(child, childPath, name);
      if (childResult) return childResult;
    }
  }

  return null;
}

/** Find an affordance in lexical scope: self, children, siblings, ancestors (each with their children one level deep). */
export function findAffordanceInScope(
  root: Sigil,
  currentPath: string[],
  name: string
): { content: string; ownerPath: string[] } | null {
  const currentSigil = findContext(root, currentPath);

  // Current sigil
  const own = findAffordance(currentSigil, name);
  if (own) return { content: own.content, ownerPath: currentPath };

  // Children
  for (const child of currentSigil.children) {
    const aff = findAffordance(child, name);
    if (aff) return { content: aff.content, ownerPath: [...currentPath, child.name] };
  }

  // Walk up: each ancestor and its children (one level deep) — includes siblings
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    const aff = findAffordance(levelSigil, name);
    if (aff) return { content: aff.content, ownerPath: levelPath };
    for (const child of levelSigil.children) {
      const childAff = findAffordance(child, name);
      if (childAff) return { content: childAff.content, ownerPath: [...levelPath, child.name] };
    }
  }

  return null;
}

const ONTOLOGIES_NAME = "Libs";

/** Build the full lexical scope for the current path: sigils (@), affordances (#), invariants (!). */
export function buildLexicalScope(
  root: Sigil,
  currentPath: string[]
): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const currentSigil = findContext(root, currentPath);

  const addSigil = (name: string, sigil: Sigil, navigable: boolean) => {
    const key = `@${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ name, prefix: "@", summary: makeSummary(sigil), navigable });
    }
  };

  // Children of current sigil
  for (const c of currentSigil.children) {
    addSigil(c.name, c, true);
  }

  // Walk up ancestry
  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    const parentPath = levelPath.slice(0, -1);
    const parentSigil = findContext(root, parentPath);

    addSigil(levelSigil.name, levelSigil, true);

    for (const c of parentSigil.children) {
      if (c.name !== levelSigil.name) {
        addSigil(c.name, c, true);
      }
    }
  }

  addSigil(root.name, root, true);

  // Flatten ontology refs
  const ontologiesSigil = root.children.find((c) => c.name === ONTOLOGIES_NAME);
  if (ontologiesSigil) {
    for (const ontology of ontologiesSigil.children) {
      addSigil(ontology.name, ontology, true);
      flattenOntologyRefs(ontology, seen, refs);
    }
  }

  // Affordances and invariants — current sigil, ancestors, children, and siblings at each level
  const addProperties = (sigil: Sigil, navigable: boolean) => {
    const ownerName = sigil.name;
    for (const a of sigil.affordances) {
      const key = `#${a.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ name: a.name, prefix: "#", summary: a.content, navigable, navigateTo: ownerName });
      }
    }
    for (const inv of sigil.invariants) {
      const key = `!${inv.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ name: inv.name, prefix: "!", summary: inv.content, navigable, navigateTo: ownerName });
      }
    }
  };

  // Current sigil's own affordances/invariants
  addProperties(currentSigil, false);

  // Children's affordances/invariants
  for (const child of currentSigil.children) {
    addProperties(child, true);
  }

  // Walk up: each ancestor and its children (one level deep) — includes siblings
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    addProperties(levelSigil, true);
    for (const child of levelSigil.children) {
      addProperties(child, true);
    }
  }

  return refs;
}

function flattenOntologyRefs(
  sigil: Sigil,
  seen: Set<string>,
  refs: Ref[]
): void {
  for (const child of sigil.children) {
    const key = `@${child.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ name: child.name, prefix: "@", summary: makeSummary(child), navigable: true });
    }
    flattenOntologyRefs(child, seen, refs);
  }
}
