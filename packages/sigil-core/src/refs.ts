import type { Affordance, Context } from "./types";
import { findContext, makeSummary } from "./tree";

export interface Ref {
  name: string;
  prefix: "@" | "#" | "!";
  summary: string;
  navigable: boolean;
  /** For affordances/invariants inherited from an ancestor, the owning context name to navigate to. */
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
export function findAffordance(ctx: Context | undefined, dashedName: string): Affordance | undefined {
  if (!ctx?.affordances) return undefined;
  const spacedName = fromDashForm(dashedName);
  const exact = ctx.affordances.find((a) => a.name === spacedName || a.name === dashedName);
  if (exact) return exact;
  const names = ctx.affordances.map((a) => a.name);
  const resolved = resolveRefName(dashedName, names);
  return resolved ? ctx.affordances.find((a) => a.name === resolved) : undefined;
}

/** Find an invariant by name, returning its content and owning path. */
function findInvariantOn(ctx: Context, path: string[], name: string): { content: string; ownerPath: string[] } | null {
  const dashed = fromDashForm(name);
  let inv = ctx.invariants.find((s) => s.name === name || s.name === dashed);
  if (!inv) {
    const resolved = resolveRefName(name, ctx.invariants.map((s) => s.name));
    if (resolved) inv = ctx.invariants.find((s) => s.name === resolved);
  }
  return inv ? { content: inv.content, ownerPath: path } : null;
}

/** Find an invariant in lexical scope: self, children, ancestors. */
export function findInvariantInScope(
  root: Context,
  currentPath: string[],
  name: string
): { content: string; ownerPath: string[] } | null {
  const currentCtx = findContext(root, currentPath);

  // Current context
  const own = findInvariantOn(currentCtx, currentPath, name);
  if (own) return own;

  // Children
  for (const child of currentCtx.children) {
    const result = findInvariantOn(child, [...currentPath, child.name], name);
    if (result) return result;
  }

  // Ancestors
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelCtx = findContext(root, levelPath);
    const result = findInvariantOn(levelCtx, levelPath, name);
    if (result) return result;
  }

  return null;
}

/** Find an affordance in lexical scope: self, children, ancestors. */
export function findAffordanceInScope(
  root: Context,
  currentPath: string[],
  name: string
): { content: string; ownerPath: string[] } | null {
  const currentCtx = findContext(root, currentPath);

  // Current context
  const own = findAffordance(currentCtx, name);
  if (own) return { content: own.content, ownerPath: currentPath };

  // Children
  for (const child of currentCtx.children) {
    const aff = findAffordance(child, name);
    if (aff) return { content: aff.content, ownerPath: [...currentPath, child.name] };
  }

  // Ancestors
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelCtx = findContext(root, levelPath);
    const aff = findAffordance(levelCtx, name);
    if (aff) return { content: aff.content, ownerPath: levelPath };
  }

  return null;
}

const ONTOLOGIES_NAME = "Libs";

/** Build the full lexical scope for the current path: contexts (@), affordances (#), invariants (!). */
export function buildLexicalScope(
  root: Context,
  currentPath: string[]
): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const currentCtx = findContext(root, currentPath);

  const addContext = (name: string, ctx: Context, navigable: boolean) => {
    const key = `@${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ name, prefix: "@", summary: makeSummary(ctx), navigable });
    }
  };

  // Children of current context
  for (const c of currentCtx.children) {
    addContext(c.name, c, true);
  }

  // Walk up ancestry
  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelCtx = findContext(root, levelPath);
    const parentPath = levelPath.slice(0, -1);
    const parentCtx = findContext(root, parentPath);

    addContext(levelCtx.name, levelCtx, true);

    for (const c of parentCtx.children) {
      if (c.name !== levelCtx.name) {
        addContext(c.name, c, true);
      }
    }
  }

  addContext(root.name, root, true);

  // Flatten ontology refs
  const ontologiesSigil = root.children.find((c) => c.name === ONTOLOGIES_NAME);
  if (ontologiesSigil) {
    for (const ontology of ontologiesSigil.children) {
      addContext(ontology.name, ontology, true);
      flattenOntologyRefs(ontology, seen, refs);
    }
  }

  // Affordances and invariants — current context, ancestors, children, and siblings at each level
  const addProperties = (ctx: Context, navigable: boolean) => {
    const ownerName = ctx.name;
    for (const a of ctx.affordances) {
      const key = `#${a.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ name: a.name, prefix: "#", summary: a.content, navigable, navigateTo: ownerName });
      }
    }
    for (const inv of ctx.invariants) {
      const key = `!${inv.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ name: inv.name, prefix: "!", summary: inv.content, navigable, navigateTo: ownerName });
      }
    }
  };

  // Current context's own affordances/invariants
  addProperties(currentCtx, false);

  // Children's affordances/invariants — these are your modeling tools
  for (const child of currentCtx.children) {
    addProperties(child, true);
  }

  // Ancestors' affordances/invariants — you can invoke things above you
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelCtx = findContext(root, levelPath);
    addProperties(levelCtx, true);
  }

  return refs;
}

function flattenOntologyRefs(
  ctx: Context,
  seen: Set<string>,
  refs: Ref[]
): void {
  for (const child of ctx.children) {
    const key = `@${child.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ name: child.name, prefix: "@", summary: makeSummary(child), navigable: true });
    }
    flattenOntologyRefs(child, seen, refs);
  }
}
