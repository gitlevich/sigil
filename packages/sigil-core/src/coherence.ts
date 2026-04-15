/**
 * Coherence — geometric coherence sensing.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere/Coherence
 *
 * The RightHemisphere senses the whole shape. Coherence answers: does
 * attention flow from the focus through the sigils to where it needs to go,
 * or is it trapped or deflected?
 *
 * Three outcomes:
 *   Arrives — the beam is straight. The work is coherent.
 *   Loops — attention enters a local attractor. Narrative capture.
 *   Veers — the narrative drifted. A sigil pulled the story off course.
 *
 * Pure functions over the SigilSpace graph. No LLM, no I/O.
 */
import type { SigilSpace, SigilNode } from "./sigilSpace";

// ── Types ──

export type CoherenceOutcome = "arrives" | "loops" | "veers";

export interface CoherenceReading {
  outcome: CoherenceOutcome;
  /** True when the shape is coherent — no escalation needed. */
  ok: boolean;
  /** Human-readable explanation. */
  reason: string;
}

// ── Public API ──

/**
 * Sense the geometric coherence of the space around the focused sigil.
 *
 * Checks two pathologies:
 *   1. Loops — is the focus trapped in a clique? (high internal density,
 *      low outward connectivity)
 *   2. Veers — are the displaced sigils reachable from focus without
 *      passing through unrelated regions?
 *
 * If neither pathology is detected, the shape arrives — it's coherent.
 */
export function sense(
  space: SigilSpace,
  focusName: string,
  displacedNames: string[],
): CoherenceReading {
  const focusNode = space.nodes.get(focusName);
  if (!focusNode) {
    return { outcome: "arrives", ok: true, reason: "Focus sigil not in space." };
  }

  // Check for loops — is the focus neighborhood a clique?
  const loopReading = detectLoop(space, focusNode);
  if (loopReading) return loopReading;

  // Check for veers — are displaced sigils reachable from focus?
  if (displacedNames.length > 0) {
    const veerReading = detectVeer(space, focusNode, displacedNames);
    if (veerReading) return veerReading;
  }

  return { outcome: "arrives", ok: true, reason: "Shape is coherent." };
}

// ── Loop detection ──

/**
 * A loop exists when the focus and its immediate neighbors form a clique:
 * most neighbors also connect to each other, but few connect outward.
 *
 * We measure: (internal edges) / (total edges of the neighborhood).
 * If the ratio exceeds a threshold, attention is trapped.
 */
function detectLoop(space: SigilSpace, focusNode: SigilNode): CoherenceReading | null {
  const neighbors = new Set(focusNode.edges.map(e => e.target));
  if (neighbors.size < 2) return null; // Can't form a loop with < 2 neighbors

  let internalEdges = 0;
  let totalEdges = 0;

  for (const neighborName of neighbors) {
    const neighborNode = space.nodes.get(neighborName);
    if (!neighborNode) continue;
    for (const edge of neighborNode.edges) {
      totalEdges++;
      if (neighbors.has(edge.target) || edge.target === focusNode.vocabulary.name) {
        internalEdges++;
      }
    }
  }

  if (totalEdges === 0) return null;

  const ratio = internalEdges / totalEdges;

  // Threshold: if > 80% of neighborhood edges are internal, it's a loop
  if (ratio > 0.8) {
    return {
      outcome: "loops",
      ok: false,
      reason: `Attention trapped — ${focusNode.vocabulary.name} and its neighbors form a closed cluster (${(ratio * 100).toFixed(0)}% internal edges).`,
    };
  }

  return null;
}

// ── Veer detection ──

/**
 * A veer exists when displaced sigils are not reachable from the focus
 * within a short path (2 hops). If the disturbance is far from where
 * attention is focused, the narrative has drifted.
 */
function detectVeer(
  space: SigilSpace,
  focusNode: SigilNode,
  displacedNames: string[],
): CoherenceReading | null {
  // Build the 2-hop neighborhood of focus
  const reachable = new Set<string>();
  reachable.add(focusNode.vocabulary.name);

  // Hop 1
  for (const edge of focusNode.edges) {
    reachable.add(edge.target);
  }

  // Hop 2
  const hop1 = [...reachable];
  for (const name of hop1) {
    const node = space.nodes.get(name);
    if (!node) continue;
    for (const edge of node.edges) {
      reachable.add(edge.target);
    }
  }

  const unreachable = displacedNames.filter(n => !reachable.has(n));

  if (unreachable.length > 0 && unreachable.length >= displacedNames.length / 2) {
    return {
      outcome: "veers",
      ok: false,
      reason: `Narrative drifted — ${unreachable.join(", ")} displaced but unreachable from ${focusNode.vocabulary.name} within 2 hops.`,
    };
  }

  return null;
}
