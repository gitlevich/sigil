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

/** Strip spaces, dashes, underscores and lowercase — the canonical lookup form. */
export function flattenName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Convert dash-separated #reference back to original affordance name. */
export function fromDashForm(dashed: string): string {
  return dashed.replace(/-/g, " ");
}

/**
 * Irregular verb pasts and participles the suffix rules cannot derive:
 * base → written forms. Consulted at registration time like every other rule,
 * so recognition stays a flat lookup.
 */
const IRREGULAR_VERB_FORMS: Record<string, string[]> = {
  bring: ["brought"],
  build: ["built"],
  buy: ["bought"],
  catch: ["caught"],
  choose: ["chose", "chosen"],
  come: ["came"],
  do: ["did", "done"],
  draw: ["drew", "drawn"],
  fight: ["fought"],
  find: ["found"],
  forget: ["forgot", "forgotten"],
  get: ["got", "gotten"],
  give: ["gave", "given"],
  go: ["went", "gone"],
  grow: ["grew", "grown"],
  hear: ["heard"],
  hide: ["hid", "hidden"],
  hold: ["held"],
  keep: ["kept"],
  know: ["knew", "known"],
  lay: ["laid"],
  lead: ["led"],
  leave: ["left"],
  lend: ["lent"],
  lose: ["lost"],
  make: ["made"],
  mean: ["meant"],
  meet: ["met"],
  pay: ["paid"],
  run: ["ran"],
  say: ["said"],
  see: ["saw", "seen"],
  seek: ["sought"],
  sell: ["sold"],
  send: ["sent"],
  show: ["shown"],
  sit: ["sat"],
  speak: ["spoke", "spoken"],
  spend: ["spent"],
  stand: ["stood"],
  take: ["took", "taken"],
  teach: ["taught"],
  tell: ["told"],
  think: ["thought"],
  understand: ["understood"],
  wake: ["woke", "woken"],
  wear: ["wore", "worn"],
  win: ["won"],
  write: ["wrote", "written"],
};

/** Ends consonant-vowel-consonant (final not w/x/y): doubles before -ed/-ing. */
const DOUBLING_END = /[b-df-hj-np-tv-z][aeiou]([b-df-hj-np-tvz])$/;

/** A consonant directly before a final -y, the condition for -ies/-ied. */
const CONSONANT_Y_END = /[b-df-hj-np-tv-z]y$/;

/**
 * All written forms that should resolve to this canonical name:
 * the name itself, its plural, its verb conjugations (regular and irregular),
 * and its adjective/noun dual. Returned flattened, so a single
 * {@link flattenName} on the lookup key is enough to match. Computed once per
 * canonical at registration time; recognition then never inflects.
 */
export function inflectionsOf(canonical: string): string[] {
  const lower = canonical.toLowerCase();
  const forms = new Set<string>();
  const add = (s: string) => forms.add(flattenName(s));
  add(lower);
  add(lower + "s");
  if (/(?:s|x|z|ch|sh)$/.test(lower)) {
    add(lower + "es");
  }
  if (CONSONANT_Y_END.test(lower) && lower.length > 2) {
    const stem = lower.slice(0, -1);
    add(stem + "ies");
    add(stem + "ied");
    add(stem + "iful");
  }
  if (lower.endsWith("iful") && lower.length > 5) {
    add(lower.slice(0, -4) + "y");
  }
  if (lower.endsWith("e")) {
    add(lower + "d");
    add(lower.slice(0, -1) + "ing");
  } else {
    add(lower + "ed");
    add(lower + "ing");
    const doubling = lower.match(DOUBLING_END);
    if (doubling) {
      add(lower + doubling[1] + "ed");
      add(lower + doubling[1] + "ing");
    }
  }
  for (const irregular of IRREGULAR_VERB_FORMS[lower] ?? []) {
    add(irregular);
  }
  return [...forms];
}

/**
 * Map from any recognized written form to the canonical(s) that registered it.
 * Multi-valued: ambiguity is the shape of the data, not a separate concern.
 */
export type NameIndex = Map<string, string[]>;

export function buildNameIndex(canonicalNames: string[]): NameIndex {
  const index: NameIndex = new Map();
  for (const canonical of canonicalNames) {
    for (const form of inflectionsOf(canonical)) {
      const list = index.get(form);
      if (list) {
        if (!list.includes(canonical)) list.push(canonical);
      } else {
        index.set(form, [canonical]);
      }
    }
  }
  return index;
}

/**
 * Resolve a (possibly inflected) written ref to its canonical name, or undefined.
 * A canonical whose own name equals the written form wins over one that only
 * matches through inflection, so an exact name is never shadowed by another
 * canonical that happens to inflect to it (e.g. `done` resolves to `done`, not
 * to `do`), regardless of registration order.
 */
export function resolveRefName(refName: string, index: NameIndex): string | undefined {
  const key = flattenName(refName);
  const matches = index.get(key);
  if (!matches) return undefined;
  return matches.find((c) => flattenName(c) === key) ?? matches[0];
}

/** All canonical names that accept this written form, exact base matches first. Empty array if none. */
export function resolveRefNameAll(refName: string, index: NameIndex): string[] {
  const key = flattenName(refName);
  const matches = index.get(key);
  if (!matches) return [];
  const exact = matches.filter((c) => flattenName(c) === key);
  const inflected = matches.filter((c) => flattenName(c) !== key);
  return [...exact, ...inflected];
}

/** Does `refName` resolve to `canonical`? Thin wrapper over {@link inflectionsOf}. */
export function nameMatches(refName: string, canonical: string): boolean {
  return inflectionsOf(canonical).includes(flattenName(refName));
}

// ── Per-sigil and per-tree index caches ────────────────────────────────────
//
// Sigil trees are immutable — on UPDATE_SPEC the whole tree is replaced, so
// old entries GC naturally. We key by Sigil identity via WeakMap.

interface SigilIndex {
  children: NameIndex;
  affordances: NameIndex;
  invariants: NameIndex;
}

const sigilIndexCache = new WeakMap<Sigil, SigilIndex>();

function indexOf(sigil: Sigil): SigilIndex {
  let cached = sigilIndexCache.get(sigil);
  if (!cached) {
    cached = {
      children: buildNameIndex(sigil.children.map((c) => c.name)),
      affordances: buildNameIndex(sigil.affordances.map((a) => a.name)),
      invariants: buildNameIndex(sigil.invariants.map((i) => i.name)),
    };
    sigilIndexCache.set(sigil, cached);
  }
  return cached;
}

interface TreeIndex {
  sigils: Map<string, { target: Sigil; path: string[] }[]>;
  affordances: Map<string, { content: string; ownerPath: string[] }[]>;
  invariants: Map<string, { content: string; ownerPath: string[] }[]>;
}

const treeIndexCache = new WeakMap<Sigil, TreeIndex>();

function flatIndexOf(root: Sigil): TreeIndex {
  let cached = treeIndexCache.get(root);
  if (cached) return cached;
  const tree: TreeIndex = { sigils: new Map(), affordances: new Map(), invariants: new Map() };
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const walk = (sigil: Sigil, path: string[]) => {
    for (const a of sigil.affordances) {
      for (const form of inflectionsOf(a.name)) {
        push(tree.affordances, form, { content: a.content, ownerPath: path });
      }
    }
    for (const inv of sigil.invariants) {
      for (const form of inflectionsOf(inv.name)) {
        push(tree.invariants, form, { content: inv.content, ownerPath: path });
      }
    }
    for (const child of sigil.children) {
      const childPath = [...path, child.name];
      for (const form of inflectionsOf(child.name)) {
        push(tree.sigils, form, { target: child, path: childPath });
      }
      walk(child, childPath);
    }
  };
  walk(root, []);
  treeIndexCache.set(root, tree);
  return tree;
}

/** Direct children of `parent` whose name matches `name` (inflection-aware). */
export function findChildrenByName(parent: Sigil, name: string): Sigil[] {
  const canonicals = indexOf(parent).children.get(flattenName(name));
  if (!canonicals) return [];
  const out: Sigil[] = [];
  for (const n of canonicals) {
    const match = parent.children.find((c) => c.name === n);
    if (match) out.push(match);
  }
  return out;
}

/** All descendants of `root` (excluding `root` itself) whose name matches `name`. */
export function findDescendantsByName(root: Sigil, name: string): { target: Sigil; path: string[] }[] {
  const hits = flatIndexOf(root).sigils.get(flattenName(name));
  return hits ? hits.slice() : [];
}

// ── Find ────────────────────────────────────────────────────────────────────

export function findAffordance(sigil: Sigil | undefined, dashedName: string): Affordance | undefined {
  if (!sigil?.affordances) return undefined;
  const spaced = fromDashForm(dashedName);
  const exact = sigil.affordances.find((a) => a.name === spaced || a.name === dashedName);
  if (exact) return exact;
  const canonical = resolveRefName(dashedName, indexOf(sigil).affordances);
  return canonical ? sigil.affordances.find((a) => a.name === canonical) : undefined;
}

function findInvariantOn(sigil: Sigil, path: string[], name: string): { content: string; ownerPath: string[] } | null {
  const spaced = fromDashForm(name);
  let inv = sigil.invariants.find((i) => i.name === name || i.name === spaced);
  if (!inv) {
    const canonical = resolveRefName(name, indexOf(sigil).invariants);
    if (canonical) inv = sigil.invariants.find((i) => i.name === canonical);
  }
  return inv ? { content: inv.content, ownerPath: path } : null;
}

/** Find an invariant in lexical scope: self, children, ancestors with their children, imported ontologies. */
export function findInvariantInScope(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): { content: string; ownerPath: string[] } | null {
  const currentSigil = findContext(root, currentPath);
  const own = findInvariantOn(currentSigil, currentPath, name);
  if (own) return own;
  for (const child of currentSigil.children) {
    const result = findInvariantOn(child, [...currentPath, child.name], name);
    if (result) return result;
  }
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    const result = findInvariantOn(levelSigil, levelPath, name);
    if (result) return result;
    for (const child of levelSigil.children) {
      const childResult = findInvariantOn(child, [...levelPath, child.name], name);
      if (childResult) return childResult;
    }
  }
  if (importedOntologies) {
    const hit = flatIndexOf(importedOntologies).invariants.get(flattenName(name))?.[0];
    if (hit) return hit;
  }
  return null;
}

/** Find an affordance in lexical scope: self, children, ancestors with their children, imported ontologies. */
export function findAffordanceInScope(
  root: Sigil,
  currentPath: string[],
  name: string,
  importedOntologies?: Sigil | null,
): { content: string; ownerPath: string[] } | null {
  const currentSigil = findContext(root, currentPath);
  const own = findAffordance(currentSigil, name);
  if (own) return { content: own.content, ownerPath: currentPath };
  for (const child of currentSigil.children) {
    const aff = findAffordance(child, name);
    if (aff) return { content: aff.content, ownerPath: [...currentPath, child.name] };
  }
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
  if (importedOntologies) {
    const hit = flatIndexOf(importedOntologies).affordances.get(flattenName(name))?.[0];
    if (hit) return hit;
  }
  return null;
}

// ── Lexical scope enumeration ───────────────────────────────────────────────

const ONTOLOGIES_NAME = "Libs";

/** Build the full lexical scope for the current path: sigils (@), affordances (#), invariants (!). */
export function buildLexicalScope(
  root: Sigil,
  currentPath: string[],
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

  for (const c of currentSigil.children) addSigil(c.name, c, true);

  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    const parentSigil = findContext(root, levelPath.slice(0, -1));
    addSigil(levelSigil.name, levelSigil, true);
    for (const c of parentSigil.children) {
      if (c.name !== levelSigil.name) addSigil(c.name, c, true);
    }
  }

  addSigil(root.name, root, true);

  const ontologiesSigil = root.children.find((c) => c.name === ONTOLOGIES_NAME);
  if (ontologiesSigil) {
    for (const ontology of ontologiesSigil.children) {
      addSigil(ontology.name, ontology, true);
      flattenOntologyRefs(ontology, seen, refs);
    }
  }

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

  addProperties(currentSigil, false);
  for (const child of currentSigil.children) addProperties(child, true);
  for (let depth = currentPath.length - 1; depth >= 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root, levelPath);
    addProperties(levelSigil, true);
    for (const child of levelSigil.children) addProperties(child, true);
  }

  return refs;
}

function flattenOntologyRefs(sigil: Sigil, seen: Set<string>, refs: Ref[]): void {
  for (const child of sigil.children) {
    const key = `@${child.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ name: child.name, prefix: "@", summary: makeSummary(child), navigable: true });
    }
    flattenOntologyRefs(child, seen, refs);
  }
}
