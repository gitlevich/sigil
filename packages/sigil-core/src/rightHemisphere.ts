/**
 * RightHemisphere — the gestalt perceiver.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere
 *
 * Sees the whole sigil from outside — its surface, bumps, discontinuities.
 * Three jobs:
 *   #continuous-attention — watches ContrastSpace for changes
 *   Subconscious#filtering — selects what experience is relevant
 *   Subconscious — autonomic behavior (consolidation during sleep)
 *
 * This module is a pure state machine. No timers, no subscriptions.
 * The caller feeds it events (sigil tree changed, focus changed).
 * It produces signals (escalation, filtered experience).
 *
 * Invariants:
 *   !always-on — attending from startup
 *   !no-network — no external dependencies
 *   !non-blocking — pure computation, no I/O
 */
import type { Sigil } from "./types";
import type { SigilSpace } from "./sigilSpace";
import { build } from "./sigilSpace";
import type { Disturbance, Watch } from "./continuousAttention";
import { init as initWatch, attend, noiseFloor, crosses } from "./continuousAttention";
import type { Resolution } from "./narration";
import { resolve } from "./narration";
import type { ShapeReading, ShapeShift } from "./shapePerception";
import { perceiveShape, diffShape } from "./shapePerception";

// ── Types ──

/** A burst of editing activity — one or more sigils changed together. */
export interface ExperienceSegment {
  /** Which sigils were involved in this burst. */
  sigils: string[];
  /** The disturbance this burst produced. */
  disturbance: Disturbance;
  /** Monotonic timestamp (Date.now() or sequence number — caller decides). */
  timestamp: number;
  /** Whether Subconscious filtering judged this relevant to active scope. */
  relevant: boolean;
  /** Narration: what the disturbance means in language. */
  resolution: Resolution | null;
  /** Shape changes detected by tree-native perception. */
  shapeShifts?: ShapeShift[];
  /** Chat message, if this segment is a conversation event. */
  message?: { role: "user" | "assistant"; content: string };
  /** LeftHemisphere articulation, if the Gate passed and the LH responded. */
  articulation?: { observation: string; suggestions: string[]; needsAttention: boolean };
}

/** Signal emitted when disturbance crosses the noise floor. */
export interface Escalation {
  disturbance: Disturbance;
  /** The noise floor at the time of escalation, for context. */
  floor: number;
}

/** The result of perceiving a change. Exactly one of these is populated. */
export interface Perception {
  /** Set when disturbance crosses the threshold — goes to CorpusCallosum. */
  escalation: Escalation | null;
  /** The experience segment produced by this change (always present). */
  experience: ExperienceSegment;
}

/** The RightHemisphere's full state. Held by the caller, threaded through. */
export interface Hemisphere {
  watch: Watch;
  /** The currently open sigil's name — defines the Subconscious's relevance scope. */
  focus: string | null;
  /** Accumulated experience segments for the current session. */
  experience: ExperienceSegment[];
  /** Previous shape reading — diffed on each perceive to detect shape changes. */
  previousShape: ShapeReading | null;
}

// ── Relevance filter (Subconscious) ──
// Spec invariant: !single-mechanism — one filter for both #filtering and #consolidate.
// Spec invariant: !relevance-gating — children always, neighbors by affordance, parent always.
// Spec invariant: !affordance-relevance — entanglement is co-occurrence, not proximity.

/**
 * Is a sigil relevant to the currently focused sigil?
 *
 * Relevance means: the sigil's affordances are entangled (co-occur in sentences)
 * with the active invariants of the focused sigil. Three tiers:
 *   - Children of focus: always relevant (the work itself)
 *   - Parent of focus: always relevant (laws of nature)
 *   - Neighbors: relevant when co-occurring with focus's affordances
 *
 * This is the single mechanism used by both #filtering and #consolidate.
 */
export function isRelevant(
  space: SigilSpace,
  focusName: string,
  changedSigil: string,
): boolean {
  const focusNode = space.nodes.get(focusName);
  if (!focusNode) return false;
  if (changedSigil === focusName) return true;

  const changedNode = space.nodes.get(changedSigil);
  if (!changedNode) return false;

  // Child: changed sigil's path is focus path + one more segment
  if (changedNode.path.length === focusNode.path.length + 1
    && changedNode.path.slice(0, -1).join("/") === focusNode.path.join("/")) {
    return true;
  }

  // Parent: focus path is changed sigil's path + one more segment
  if (focusNode.path.length === changedNode.path.length + 1
    && focusNode.path.slice(0, -1).join("/") === changedNode.path.join("/")) {
    return true;
  }

  // Neighbor: co-occurs with focus (has an edge)
  const edge = focusNode.edges.find(e => e.target === changedSigil);
  return edge !== undefined;
}

// ── Public API ──

/**
 * Initialize the RightHemisphere. Call at app startup with the initial sigil tree.
 *
 * Spec invariant: !always-on — no cold start.
 */
export function open(root: Sigil, importedOntologies?: Sigil | null): Hemisphere {
  const space = build(root, importedOntologies);
  const shape = perceiveShape(root, space);
  return {
    watch: initWatch(space),
    focus: null,
    experience: [],
    previousShape: shape,
  };
}

/**
 * Set which sigil the user is currently looking at.
 * This defines the Subconscious's relevance scope.
 */
export function focusOn(hemisphere: Hemisphere, sigilName: string): Hemisphere {
  return { ...hemisphere, focus: sigilName, previousShape: hemisphere.previousShape };
}

/**
 * Perceive a change in the sigil tree. The core cycle:
 * 1. Rebuild SigilSpace from the changed tree
 * 2. Attend: sense disturbance
 * 3. If crosses threshold → escalation signal
 * 4. Filter experience by relevance to current focus
 * 5. Append to experience log
 *
 * Returns the perception and the updated hemisphere state.
 */
export function perceive(
  hemisphere: Hemisphere,
  root: Sigil,
  changedSigils: string[],
  timestamp: number,
  importedOntologies?: Sigil | null,
): [Perception, Hemisphere] {
  const currentSpace = build(root, importedOntologies);
  const previousSpace = hemisphere.watch.previous;
  const [coOccurrenceDisturbance, nextWatch] = attend(hemisphere.watch, currentSpace);

  // Shape perception: diff the tree-native shape reading
  const currentShape = perceiveShape(root, currentSpace);
  const shapeShifts = hemisphere.previousShape
    ? diffShape(hemisphere.previousShape, currentShape)
    : [];

  // Merge signals: co-occurrence displacement + shape shifts.
  // Shape shifts contribute to disturbance magnitude so the RH notices
  // edits that don't change co-occurrence topology (new affordances,
  // changed language, structural reorganization).
  const shapeMagnitude = shapeShifts.reduce((sum, s) =>
    sum + Math.abs(s.weaveChange) + Math.abs(s.leakageChange)
    + Math.abs(s.groundingChange)
    + (s.surfaceChange !== 0 ? 0.5 : 0)
    + (s.volumeChange !== 0 ? Math.min(Math.abs(s.volumeChange) / 100, 1) : 0)
    + s.newGaps.length * 0.5 + s.filledGaps.length * 0.5
    + s.newOrphans.length * 0.5 + s.connectedOrphans.length * 0.5
  , 0);

  // Build combined disturbance — shape shifts produce displaced sigils too
  const shapeDisplaced = shapeShifts
    .map(s => ({
      name: s.name,
      magnitude: Math.abs(s.weaveChange) + Math.abs(s.leakageChange)
        + Math.abs(s.groundingChange)
        + (s.surfaceChange !== 0 ? 0.5 : 0)
        + (s.volumeChange !== 0 ? Math.min(Math.abs(s.volumeChange) / 100, 1) : 0)
        + s.newGaps.length * 0.5 + s.filledGaps.length * 0.5
        + s.newOrphans.length * 0.5 + s.connectedOrphans.length * 0.5,
    }))
    .filter(s => s.magnitude > 0);

  // Merge displaced lists — co-occurrence + shape, deduplicating by name
  const displacedMap = new Map<string, number>();
  for (const d of coOccurrenceDisturbance.displaced) {
    displacedMap.set(d.name, (displacedMap.get(d.name) ?? 0) + d.magnitude);
  }
  for (const d of shapeDisplaced) {
    displacedMap.set(d.name, (displacedMap.get(d.name) ?? 0) + d.magnitude);
  }
  const mergedDisplaced = [...displacedMap.entries()]
    .map(([name, magnitude]) => ({ name, magnitude }))
    .sort((a, b) => b.magnitude - a.magnitude);

  const disturbance: Disturbance = {
    displaced: mergedDisplaced,
    total: coOccurrenceDisturbance.total + shapeMagnitude,
  };

  const floor = noiseFloor(nextWatch);
  const escalation = crosses(disturbance, floor)
    ? { disturbance, floor }
    : null;

  // Narration: resolve the disturbance into language — including shape shifts
  const resolution = disturbance.total > 0
    ? resolve(previousSpace, currentSpace, disturbance, hemisphere.focus, shapeShifts)
    : null;

  // Subconscious#filtering — is this burst relevant to what we're looking at?
  const relevant = hemisphere.focus !== null
    && (changedSigils.some(s => isRelevant(currentSpace, hemisphere.focus!, s))
      || shapeShifts.some(s => s.name === hemisphere.focus));

  const segment: ExperienceSegment = {
    sigils: changedSigils,
    disturbance,
    timestamp,
    relevant,
    resolution,
    shapeShifts: shapeShifts.length > 0 ? shapeShifts : undefined,
  };

  const perception: Perception = { escalation, experience: segment };

  const nextHemisphere: Hemisphere = {
    watch: nextWatch,
    focus: hemisphere.focus,
    experience: [...hemisphere.experience, segment],
    previousShape: currentShape,
  };

  return [perception, nextHemisphere];
}

/**
 * Subconscious#consolidate — review accumulated experience in bulk.
 *
 * Returns segments that pass the relevance filter. Called during idle periods
 * or between sessions. Uses the same filter as live #filtering.
 *
 * Spec invariant: !single-mechanism — same filter, different scope.
 * Spec invariant: !no-escalation — never invokes the LeftHemisphere.
 */
export function consolidate(hemisphere: Hemisphere): ExperienceSegment[] {
  return hemisphere.experience.filter(s => s.relevant);
}
