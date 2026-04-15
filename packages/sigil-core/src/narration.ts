/**
 * Narration — compresses geometric disturbance into language.
 *
 * Spec path: DesignPartner/BicameralMind/CorpusCallosum/Narration
 * Affordance: #resolve — convert a geometric disturbance in ContrastSpace
 * into a scoped escalation: which sigil changed, what type of change,
 * and the lexical scope the LeftHemisphere needs to work with.
 *
 * Invariant: !relevance — narration compresses by relevance,
 * whatever contrasts apply in the direction attention is focusing on.
 *
 * Pure functions. No LLM calls — this is structural narration from
 * the geometry itself. The LeftHemisphere adds interpretation later.
 */
import type { SigilSpace } from "./sigilSpace";
import type { Disturbance, DisplacedSigil } from "./continuousAttention";

// ── Types ──

/** What kind of structural change occurred. */
export type ChangeKind =
  | "reference-added"      // new co-occurrence edge appeared
  | "reference-removed"    // co-occurrence edge disappeared
  | "reference-shifted"    // edge weight changed
  | "sigil-appeared"       // new node in the space
  | "sigil-disappeared";   // node removed from the space

/** One resolved change — a disturbance compressed into language. */
export interface ResolvedChange {
  /** The sigil that was displaced. */
  sigil: string;
  /** How much it moved (L1 distance in co-occurrence space). */
  magnitude: number;
  /** What kind of structural change. */
  kind: ChangeKind;
  /** Which other sigils are involved (the other end of changed edges). */
  partners: string[];
  /** A human-readable sentence describing the change. */
  description: string;
}

/** The full narration of a disturbance — ready for the LeftHemisphere or the UI. */
export interface Resolution {
  /** The focus sigil at the time of the disturbance. */
  focus: string | null;
  /** Resolved changes, sorted by magnitude descending. */
  changes: ResolvedChange[];
  /** One-line summary of the whole disturbance. */
  summary: string;
}

// ── Resolution logic ──

/**
 * Resolve a disturbance into language.
 *
 * Compares old and new SigilSpaces to determine what actually changed
 * for each displaced sigil: which edges appeared, disappeared, or shifted.
 * Produces human-readable descriptions.
 */
export function resolve(
  oldSpace: SigilSpace,
  newSpace: SigilSpace,
  disturbance: Disturbance,
  focus: string | null,
): Resolution {
  if (disturbance.displaced.length === 0) {
    return { focus, changes: [], summary: "No structural change." };
  }

  const changes: ResolvedChange[] = [];

  for (const displaced of disturbance.displaced) {
    const resolved = resolveOne(oldSpace, newSpace, displaced);
    changes.push(...resolved);
  }

  // Sort by magnitude descending
  changes.sort((a, b) => b.magnitude - a.magnitude);

  const summary = buildSummary(changes, focus);

  return { focus, changes, summary };
}

function resolveOne(
  oldSpace: SigilSpace,
  newSpace: SigilSpace,
  displaced: DisplacedSigil,
): ResolvedChange[] {
  const { name, magnitude } = displaced;
  const oldNode = oldSpace.nodes.get(name);
  const newNode = newSpace.nodes.get(name);

  // Sigil appeared or disappeared
  if (!oldNode && newNode) {
    return [{
      sigil: name,
      magnitude,
      kind: "sigil-appeared",
      partners: newNode.edges.map(e => e.target),
      description: `${name} appeared in the space.`,
    }];
  }
  if (oldNode && !newNode) {
    return [{
      sigil: name,
      magnitude,
      kind: "sigil-disappeared",
      partners: oldNode.edges.map(e => e.target),
      description: `${name} disappeared from the space.`,
    }];
  }
  if (!oldNode || !newNode) return [];

  // Compare edges
  const oldEdges = new Map(oldNode.edges.map(e => [e.target, e.count]));
  const newEdges = new Map(newNode.edges.map(e => [e.target, e.count]));
  const allTargets = new Set([...oldEdges.keys(), ...newEdges.keys()]);

  const results: ResolvedChange[] = [];

  for (const target of allTargets) {
    const oldCount = oldEdges.get(target) ?? 0;
    const newCount = newEdges.get(target) ?? 0;
    if (oldCount === newCount) continue;

    const edgeMagnitude = Math.abs(newCount - oldCount);

    if (oldCount === 0 && newCount > 0) {
      results.push({
        sigil: name,
        magnitude: edgeMagnitude,
        kind: "reference-added",
        partners: [target],
        description: `${name} now co-occurs with ${target}.`,
      });
    } else if (oldCount > 0 && newCount === 0) {
      results.push({
        sigil: name,
        magnitude: edgeMagnitude,
        kind: "reference-removed",
        partners: [target],
        description: `${name} no longer co-occurs with ${target}.`,
      });
    } else {
      const dir = newCount > oldCount ? "closer to" : "farther from";
      results.push({
        sigil: name,
        magnitude: edgeMagnitude,
        kind: "reference-shifted",
        partners: [target],
        description: `${name} moved ${dir} ${target}.`,
      });
    }
  }

  return results;
}

function buildSummary(changes: ResolvedChange[], focus: string | null): string {
  if (changes.length === 0) return "No structural change.";

  const top = changes.slice(0, 3);
  const descriptions = top.map(c => c.description);
  const rest = changes.length - top.length;

  let summary = descriptions.join(" ");
  if (rest > 0) summary += ` And ${rest} more.`;
  if (focus) summary = `[${focus}] ${summary}`;

  return summary;
}
