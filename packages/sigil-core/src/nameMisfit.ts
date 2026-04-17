/**
 * NameMisfit — detection for `#senses-name-misfit` on the RightHemisphere.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere/affordance-senses-name-misfit
 *
 * A resolved @reference can still be wrong: the name lands on a real sigil,
 * but the sigil's co-occurrence neighborhood does not match what the
 * surrounding sentences ask the name to carry. The compile is clean; the
 * meaning is still off.
 *
 * The detector uses the SigilSpace's co-occurrence counts as its ground truth.
 * For each @ref on a line that mentions >=1 other resolved @ref:
 *   - subtract this line's contribution from the space's counts
 *   - if the ref has never co-occurred with any of its line-mates elsewhere,
 *     and the ref has a meaningful amount of external co-occurrence
 *     (it is a well-connected sigil, not a freshly introduced one),
 *     then the ref is a likely misfit — well-placed elsewhere, out of place here.
 *
 * This is a "sense of unease," not a conviction. False positives are
 * acceptable. The signal is suspicion.
 */
import type { Sigil } from "./types";
import type { SigilSpace } from "./sigilSpace";
import { build } from "./sigilSpace";
import { allRefsPattern, isInCodeSpan } from "./refs-pattern";
import { resolve } from "./lexicalScope";

/** A single suspicion: this @ref on this line looks out of place. */
export interface NameMisfit {
  /** Path from root to the sigil where the misfit appears. */
  path: string[];
  /** Filename within the sigil (language.md, affordance-*.md, invariant-*.md). */
  file: string;
  /** 1-indexed line number within the file. */
  line: number;
  /** The @reference as written. */
  ref: string;
  /** The canonical sigil name it resolved to. */
  resolvedTo: string;
  /** The other canonical sigil names it shares this line with. */
  neighborhood: string[];
  /** Human-readable explanation of why this looks off. */
  reason: string;
}

/** Options for tuning the detector's sensitivity. */
export interface NameMisfitOptions {
  /**
   * Minimum external total edge count for a ref to be considered
   * "seriously embedded." Below this, the ref has not accumulated enough
   * co-occurrence history to trust that a new placement is anomalous vs
   * simply novel. Default: 6.
   */
  minRichness?: number;
  /**
   * Minimum co-occurrence count for a neighbor to be considered "stable."
   * A ref must have at least one stable external neighbor for a misfit to
   * fire — the signal is "well-connected elsewhere," which requires some
   * established pattern to depart from. Default: 3.
   */
  minStableCompanionCount?: number;
  /**
   * Minimum number of line-mates required for a ref to be tested. A single
   * co-occurrence is weak evidence; multiple strangers together is the
   * stronger signal. Default: 2.
   */
  minLineMates?: number;
  /**
   * The ref's strongest stable companion must have an external count at
   * least this many times larger than its strongest connection to any
   * line-mate, to fire. Without dominance, the placement is arguably
   * another legitimate companion. Default: 3.
   */
  minDominanceRatio?: number;
}

const DEFAULT_MIN_RICHNESS = 4;
const DEFAULT_MIN_STABLE_COMPANION = 2;
const DEFAULT_MIN_LINE_MATES = 2;
const DEFAULT_MIN_DOMINANCE = 3;

interface RefOnLine {
  token: string;
  line: number;
  resolvedName: string;
}

/**
 * Extract resolved @sigil refs from a single line, preserving their token text.
 * Skips refs inside code spans and refs that do not resolve.
 */
function extractResolvedRefs(
  line: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
): { token: string; resolvedName: string }[] {
  const result: { token: string; resolvedName: string }[] = [];
  allRefsPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = allRefsPattern.exec(line)) !== null) {
    if (isInCodeSpan(line, m.index)) continue;
    const token = m[0];
    if (!token.startsWith("@")) continue;

    // Strip any trailing #affordance or !invariant — only the sigil part resolves.
    const propMatch = token.match(/[#!][a-zA-Z_][\w-]*$/);
    const sigilPart = propMatch ? token.slice(0, propMatch.index) : token;

    const resolved = resolve(root, currentPath, sigilPart, importedOntologies);
    if (!resolved || resolved.ambiguous) continue;
    result.push({ token, resolvedName: resolved.target.name });
  }
  return result;
}

/**
 * Test a single ref on a line against its line-mates.
 * Returns a NameMisfit if the ref looks misplaced, or null if it fits.
 */
function testRef(
  space: SigilSpace,
  ref: RefOnLine,
  lineMates: string[],
  path: string[],
  file: string,
  minRichness: number,
  minStableCompanion: number,
  minLineMates: number,
  minDominance: number,
): NameMisfit | null {
  const node = space.nodes.get(ref.resolvedName);
  if (!node) return null;
  if (lineMates.length < minLineMates) return null;

  const edgeCounts = new Map(node.edges.map(e => [e.target, e.count]));

  // External co-occurrence with line-mates: the strongest external link from
  // this ref to any of its line-mates. If any mate is a known companion
  // externally, this placement isn't anomalous.
  let maxExternalToMate = 0;
  for (const mate of lineMates) {
    const total = edgeCounts.get(mate) ?? 0;
    const external = Math.max(0, total - 1);
    if (external > maxExternalToMate) maxExternalToMate = external;
  }
  if (maxExternalToMate > 0) return null;

  // External total edge count and strongest stable companion (excluding
  // contributions from this line).
  let externalTotalEdgeCount = 0;
  let strongestStableCompanion = 0;
  for (const edge of node.edges) {
    const inLine = lineMates.includes(edge.target) ? 1 : 0;
    const external = Math.max(0, edge.count - inLine);
    externalTotalEdgeCount += external;
    if (external > strongestStableCompanion) strongestStableCompanion = external;
  }

  if (strongestStableCompanion < minStableCompanion) return null;
  if (externalTotalEdgeCount < minRichness) return null;

  // Dominance: the strongest established companion must be meaningfully
  // larger than the strongest external link to any line-mate. Since we
  // already filtered at maxExternalToMate === 0 above, this is equivalent
  // to requiring strongestStableCompanion >= minDominance. Keeping the
  // check explicit so the rule is legible and easy to generalize later
  // (e.g. when we allow weak mate connections through).
  if (strongestStableCompanion < Math.max(1, maxExternalToMate) * minDominance) return null;

  // Compose a reason naming the ref's typical neighbors (excluding line-mates).
  const topNeighbors = node.edges
    .filter(e => !lineMates.includes(e.target))
    .slice(0, 3)
    .map(e => e.target);

  const reason = topNeighbors.length > 0
    ? `${ref.token} usually appears with ${topNeighbors.map(n => `@${n}`).join(", ")}, not these.`
    : `${ref.token} has never appeared with these sigils before.`;

  return {
    path,
    file,
    line: ref.line,
    ref: ref.token,
    resolvedTo: ref.resolvedName,
    neighborhood: lineMates,
    reason,
  };
}

/**
 * Detect misfits in a single content block.
 */
function detectInContent(
  content: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
  space: SigilSpace,
  file: string,
  minRichness: number,
  minStableCompanion: number,
  minLineMates: number,
  minDominance: number,
  result: NameMisfit[],
): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const refs = extractResolvedRefs(line, root, currentPath, importedOntologies);
    if (refs.length < 2) continue;

    // Unique line-mates for each tested ref.
    const uniqueNames = [...new Set(refs.map(r => r.resolvedName))];
    if (uniqueNames.length < 2) continue;

    for (const ref of refs) {
      const mates = uniqueNames.filter(n => n !== ref.resolvedName);
      const misfit = testRef(
        space,
        { token: ref.token, line: i + 1, resolvedName: ref.resolvedName },
        mates,
        currentPath,
        file,
        minRichness,
        minStableCompanion,
        minLineMates,
        minDominance,
      );
      if (misfit) result.push(misfit);
    }
  }
}

/**
 * Walk the sigil tree, checking every content block for name misfits.
 */
function walkDetect(
  sigil: Sigil,
  path: string[],
  root: Sigil,
  importedOntologies: Sigil | null,
  space: SigilSpace,
  minRichness: number,
  minStableCompanion: number,
  minLineMates: number,
  minDominance: number,
  result: NameMisfit[],
): void {
  if (sigil.language) {
    detectInContent(sigil.language, root, path, importedOntologies, space, "language.md", minRichness, minStableCompanion, minLineMates, minDominance, result);
  }
  for (const aff of sigil.affordances) {
    detectInContent(aff.content, root, path, importedOntologies, space, `affordance-${aff.name}.md`, minRichness, minStableCompanion, minLineMates, minDominance, result);
  }
  for (const inv of sigil.invariants) {
    detectInContent(inv.content, root, path, importedOntologies, space, `invariant-${inv.name}.md`, minRichness, minStableCompanion, minLineMates, minDominance, result);
  }
  for (const child of sigil.children) {
    if (child.isImported) continue;
    walkDetect(child, [...path, child.name], root, importedOntologies, space, minRichness, minStableCompanion, minLineMates, minDominance, result);
  }
}

/**
 * Detect all name misfits across a sigil tree.
 *
 * Returns suspicions, not errors. Each misfit is a resolved @reference whose
 * sphere sits in the wrong neighborhood for the line it appears in.
 */
export function detectNameMisfits(
  root: Sigil,
  importedOntologies?: Sigil | null,
  options?: NameMisfitOptions,
): NameMisfit[] {
  const libs = importedOntologies ?? null;
  const space = build(root, libs);
  const minRichness = options?.minRichness ?? DEFAULT_MIN_RICHNESS;
  const minStableCompanion = options?.minStableCompanionCount ?? DEFAULT_MIN_STABLE_COMPANION;
  const minLineMates = options?.minLineMates ?? DEFAULT_MIN_LINE_MATES;
  const minDominance = options?.minDominanceRatio ?? DEFAULT_MIN_DOMINANCE;
  const result: NameMisfit[] = [];
  walkDetect(root, [], root, libs, space, minRichness, minStableCompanion, minLineMates, minDominance, result);
  return result;
}
