/**
 * ContrastSpace — a space of Positions.
 *
 * Spec: BicameralMind/RightHemisphere/CoOccurrenceGeometry/ContrastSpace
 *
 * Affordances: place, neighbors, displacement.
 * Invariants: co-occurrence-grounded, complete, incremental.
 *
 * I hold every sigil's Position. I place new Positions and update them when
 * they shift. I find neighbors near any Position. I measure displacement
 * between where a Position was and where it is now. I know which Position
 * is InhabitedSigil.
 */

import type { Sigil } from "sigil-core";
import {
  extractCoOccurrences,
  coOccurrenceDistance,
} from "sigil-core";
import type { Position } from "./position";
import { distance } from "./position";
import type { InhabitedSigil } from "./inhabited_sigil";

export type { Position } from "./position";
export type { InhabitedSigil } from "./inhabited_sigil";
export { distance } from "./position";

export interface ContrastSpace {
  /** All Positions, keyed by sigil name. */
  positions: Map<string, Position>;
  /** The currently inhabited sigil. */
  inhabitedSigil: InhabitedSigil | null;
  /** Previous positions for displacement measurement, keyed by sigil name. */
  previousPositions: Map<string, Position>;
}

/** Create an empty ContrastSpace. */
export function createContrastSpace(): ContrastSpace {
  return {
    positions: new Map(),
    inhabitedSigil: null,
    previousPositions: new Map(),
  };
}

/**
 * Place — compute Positions from a sigil tree and its co-occurrence data.
 * Rebuilds the entire space from the tree. Preserves previous positions
 * for displacement measurement.
 */
export function place(space: ContrastSpace, root: Sigil): ContrastSpace {
  const importedOntologies = root.children.find((c) => c.isImported) ?? null;
  const coOccurrences = extractCoOccurrences(root, importedOntologies);

  // Save current positions as previous for displacement
  const previousPositions = new Map(space.positions);
  const positions = new Map<string, Position>();

  function walkSigil(sigil: Sigil, path: string[]) {
    if (sigil.isImported) return;

    const distances = new Map<string, number>();
    for (const otherName of coOccurrences.names) {
      if (otherName === sigil.name) continue;
      const dist = coOccurrenceDistance(coOccurrences, sigil.name, otherName);
      if (dist !== Infinity) {
        distances.set(otherName, dist);
      }
    }

    positions.set(sigil.name, {
      name: sigil.name,
      path,
      affordances: sigil.affordances,
      invariants: sigil.invariants,
      distances,
    });

    for (const child of sigil.children) {
      walkSigil(child, [...path, child.name]);
    }
  }

  walkSigil(root, []);

  // Preserve inhabited sigil if it still exists
  const inhabitedSigil = space.inhabitedSigil
    ? positions.has(space.inhabitedSigil.position.name)
      ? { position: positions.get(space.inhabitedSigil.position.name)! }
      : null
    : null;

  return { positions, inhabitedSigil, previousPositions };
}

/** Find the n closest Positions to a given Position. */
export function neighbors(
  space: ContrastSpace,
  target: Position,
  n: number,
): Position[] {
  const scored: { position: Position; dist: number }[] = [];

  for (const pos of space.positions.values()) {
    if (pos.name === target.name) continue;
    scored.push({ position: pos, dist: distance(target, pos) });
  }

  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, n).map((s) => s.position);
}

/** Measure how much a Position shifted since the last place call. */
export function displacement(
  space: ContrastSpace,
  name: string,
): number | null {
  const current = space.positions.get(name);
  const previous = space.previousPositions.get(name);
  if (!current || !previous) return null;

  // Compare distance maps — sum of absolute changes in all co-occurrence distances
  let totalShift = 0;
  const allNeighbors = new Set([
    ...current.distances.keys(),
    ...previous.distances.keys(),
  ]);

  for (const neighbor of allNeighbors) {
    const currentDist = current.distances.get(neighbor) ?? Infinity;
    const previousDist = previous.distances.get(neighbor) ?? Infinity;
    if (currentDist === Infinity && previousDist === Infinity) continue;
    if (currentDist === Infinity || previousDist === Infinity) {
      totalShift += 1; // appeared or disappeared — maximum unit shift
    } else {
      totalShift += Math.abs(currentDist - previousDist);
    }
  }

  return totalShift;
}

/** Set the inhabited sigil by name. */
export function inhabit(
  space: ContrastSpace,
  name: string,
): ContrastSpace {
  const position = space.positions.get(name);
  if (!position) return space;
  return {
    ...space,
    inhabitedSigil: { position },
  };
}
