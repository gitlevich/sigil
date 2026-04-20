/**
 * OutgrownPlacement — detection for the DesignPartner's
 * #sense-outgrown-placement faculty.
 *
 * Spec path: bicameron.sigil/affordance-sense-outgrown-placement
 *
 * A sigil outgrows its placement when it was autocreated as a local child —
 * born while expressing a parent — but is attended from many sigils outside
 * that parent's scope. The geometry is wrong: its shape sits deeper than its
 * reach. @attention inside @coherent is the canonical case: defined while
 * writing about coherence, but referenced everywhere, so it wants to rise
 * to where its attendants can hold it as peers.
 *
 * The detector walks the tree, collects every resolved @reference to each
 * sigil S (the attendants), excludes references from inside S's own subtree
 * and from imported Libs (ambient scope), and computes the deepest common
 * ancestor of all remaining attendants. If that ancestor is strictly shallower
 * than S's current parent, S wants to rise.
 */
import type { Sigil } from "./types";
import { allRefsPattern, isInCodeSpan } from "./refs-pattern";
import { resolve } from "./lexicalScope";
import { build as buildSigilSpace } from "./sigilSpace";
import { isEmergenceAnchored, type EmergenceAnchorOptions } from "./emergenceAnchor";

/** One attendant reference to the sigil — where it was written. */
export interface Attendant {
  /** Path to the sigil containing the reference (attendant's owner). */
  path: string[];
  /** Filename within the sigil (language.md, affordance-*.md, invariant-*.md). */
  file: string;
  /** 1-indexed line number within the file. */
  line: number;
  /** The @reference as written. */
  token: string;
}

/** A single nudge: this sigil wants to rise to that placement. */
export interface OutgrownPlacement {
  /** Full path of the sigil whose placement has been outgrown. */
  path: string[];
  /** Current parent path (where the sigil sits now). */
  currentParent: string[];
  /** Shallowest parent path that would keep every attendant in scope. */
  optimalParent: string[];
  /** Human-readable name of the optimal parent ("" for root). */
  optimalParentName: string;
  /** Every external reference pulling the sigil outward. */
  attendants: Attendant[];
}

/** Options for tuning the detector's sensitivity. */
export interface OutgrownPlacementOptions {
  /**
   * Minimum number of external attendants required before the sense fires.
   * With a single attendant the signal is weak — one stray reference is not
   * a neighborhood. Default: 2.
   */
  minAttendants?: number;
  /**
   * Tuning for the emergence-through-parent check that suppresses rises
   * which would strand the sigil from the place its meaning unfolds.
   */
  anchor?: EmergenceAnchorOptions;
  /**
   * Skip the semantic anchor check and return every structural candidate.
   * Only useful for tests that want the raw structural pull without the
   * embedding veto. Default: false.
   */
  skipAnchorCheck?: boolean;
}

const DEFAULT_MIN_ATTENDANTS = 2;

/** Walk the tree and collect every resolved @reference with its origin. */
function collectAttendants(
  root: Sigil,
  importedOntologies: Sigil | null,
): Map<string, Attendant[]> {
  // Keyed by "/" + path.join("/") — "/" is root itself (has no path).
  const byTargetKey = new Map<string, Attendant[]>();

  const visit = (content: string, ownerPath: string[], file: string) => {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      allRefsPattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = allRefsPattern.exec(line)) !== null) {
        if (isInCodeSpan(line, m.index)) continue;
        const token = m[0];
        if (!token.startsWith("@")) continue;

        // Strip trailing #affordance or !invariant — only the sigil resolves.
        const propMatch = token.match(/[#!][a-zA-Z_][\w-]*$/);
        const sigilPart = propMatch ? token.slice(0, propMatch.index) : token;

        const res = resolve(root, ownerPath, sigilPart, importedOntologies);
        if (!res || res.ambiguous) continue;
        // Ignore references that resolved into imported ontologies — Libs are
        // ambient scope, their placement is not ours to change.
        if (res.kind === "lib") continue;
        // Ignore ancestor self-reference ("@Self" pointing to the owner itself).
        if (res.path.length === ownerPath.length
          && res.path.every((p, idx) => p === ownerPath[idx])) continue;

        const key = "/" + res.path.join("/");
        const list = byTargetKey.get(key) ?? [];
        list.push({ path: ownerPath, file, line: i + 1, token });
        byTargetKey.set(key, list);
      }
    }
  };

  const walk = (sigil: Sigil, path: string[]) => {
    if (sigil.isImported) return;
    if (sigil.language) visit(sigil.language, path, "language.md");
    for (const aff of sigil.affordances) {
      visit(aff.content, path, `affordance-${aff.name}.md`);
    }
    for (const inv of sigil.invariants) {
      visit(inv.content, path, `invariant-${inv.name}.md`);
    }
    for (const child of sigil.children) {
      walk(child, [...path, child.name]);
    }
  };
  walk(root, []);
  return byTargetKey;
}

/** True when `maybeAncestor` is a proper ancestor of `path` (or equal). */
function isAncestorOrSelf(maybeAncestor: string[], path: string[]): boolean {
  if (maybeAncestor.length > path.length) return false;
  for (let i = 0; i < maybeAncestor.length; i++) {
    if (maybeAncestor[i] !== path[i]) return false;
  }
  return true;
}

/** Deepest common ancestor path shared by all the given paths. */
function deepestCommonAncestor(paths: string[][]): string[] {
  if (paths.length === 0) return [];
  const first = paths[0];
  let shared = first.length;
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i];
    const max = Math.min(shared, p.length);
    let j = 0;
    while (j < max && first[j] === p[j]) j++;
    shared = j;
    if (shared === 0) break;
  }
  return first.slice(0, shared);
}

/** Walk every sigil in the tree (excluding root and imports). */
function eachSigil(root: Sigil, fn: (sigil: Sigil, path: string[]) => void): void {
  const walk = (sigil: Sigil, path: string[]) => {
    if (sigil.isImported) return;
    for (const child of sigil.children) {
      if (child.isImported) continue;
      const childPath = [...path, child.name];
      fn(child, childPath);
      walk(child, childPath);
    }
  };
  walk(root, []);
}

/**
 * Detect every sigil whose attendants pull it shallower than its current parent.
 *
 * The rule: a sigil's optimal parent is the deepest ancestor that contains all
 * of its external attendants. If that ancestor is strictly shallower than the
 * sigil's current parent, the sigil wants to rise. References from inside the
 * sigil's own subtree do not pull — they are already in scope. References from
 * imported ontologies do not pull — Libs are ambient scope.
 */
export function detectOutgrownPlacements(
  root: Sigil,
  importedOntologies?: Sigil | null,
  options?: OutgrownPlacementOptions,
): OutgrownPlacement[] {
  const libs = importedOntologies ?? null;
  const minAttendants = options?.minAttendants ?? DEFAULT_MIN_ATTENDANTS;
  const attendantsByKey = collectAttendants(root, libs);
  // The embedding is built lazily and shared across every candidate check —
  // this is the same ContrastSpace #sense-name-misfit already reads from.
  const space = options?.skipAnchorCheck ? null : buildSigilSpace(root, libs);

  const out: OutgrownPlacement[] = [];
  eachSigil(root, (_sigil, path) => {
    const key = "/" + path.join("/");
    const all = attendantsByKey.get(key);
    if (!all) return;

    // External attendants: not inside this sigil's own subtree.
    const external = all.filter((a) => !isAncestorOrSelf(path, a.path));
    if (external.length < minAttendants) return;

    const dca = deepestCommonAncestor(external.map((a) => a.path));
    const currentParent = path.slice(0, -1);

    // Fire only when the optimal parent is strictly shallower than current.
    // Strictly-shallower means: dca is a proper ancestor of currentParent.
    if (dca.length >= currentParent.length) return;
    if (!isAncestorOrSelf(dca, currentParent)) return;

    // Consult #sense-emergence-through-parent. If the sigil's embedding
    // anchors it below the proposed new level, the rise would strand it
    // among strangers and is not proposed.
    if (space && isEmergenceAnchored(space, root, path, dca, options?.anchor)) {
      return;
    }

    out.push({
      path,
      currentParent,
      optimalParent: dca,
      optimalParentName: dca.length === 0 ? root.name : dca[dca.length - 1],
      attendants: external,
    });
  });
  return out;
}
