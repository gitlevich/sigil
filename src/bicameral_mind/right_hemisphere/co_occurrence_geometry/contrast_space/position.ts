/**
 * Position — a sigil's location in ContrastSpace with its vocabulary.
 *
 * Spec: BicameralMind/RightHemisphere/CoOccurrenceGeometry/ContrastSpace/Position
 * Invariant: vocabulary-attached — a Position always carries name, affordances, invariants.
 * Affordance: distance — measure how far apart two Positions are.
 */

import type { Affordance, Invariant } from "sigil-core";

export interface Position {
  /** The sigil's name — the handle for recognition. */
  name: string;
  /** Path from root to this sigil. */
  path: string[];
  /** The sigil's affordances — what it offers. */
  affordances: Affordance[];
  /** The sigil's invariants — what must hold inside it. */
  invariants: Invariant[];
  /**
   * Co-occurrence distances to other sigils.
   * Key is the other sigil's name, value is inverse co-occurrence count.
   * Absent key means never co-occurred (infinite distance).
   */
  distances: Map<string, number>;
}

/** Measure how far apart two Positions are via their co-occurrence distance. */
export function distance(a: Position, b: Position): number {
  return a.distances.get(b.name) ?? Infinity;
}
