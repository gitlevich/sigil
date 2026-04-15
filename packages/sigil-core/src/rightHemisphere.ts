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
  return {
    watch: initWatch(space),
    focus: null,
    experience: [],
  };
}

/**
 * Set which sigil the user is currently looking at.
 * This defines the Subconscious's relevance scope.
 */
export function focusOn(hemisphere: Hemisphere, sigilName: string): Hemisphere {
  return { ...hemisphere, focus: sigilName };
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
  const [disturbance, nextWatch] = attend(hemisphere.watch, currentSpace);

  const floor = noiseFloor(nextWatch);
  const escalation = crosses(disturbance, floor)
    ? { disturbance, floor }
    : null;

  // Narration: resolve the disturbance into language
  const resolution = disturbance.total > 0
    ? resolve(previousSpace, currentSpace, disturbance, hemisphere.focus)
    : null;

  // Subconscious#filtering — is this burst relevant to what we're looking at?
  const relevant = hemisphere.focus !== null
    && changedSigils.some(s => isRelevant(currentSpace, hemisphere.focus!, s));

  const segment: ExperienceSegment = {
    sigils: changedSigils,
    disturbance,
    timestamp,
    relevant,
    resolution,
  };

  const perception: Perception = { escalation, experience: segment };

  const nextHemisphere: Hemisphere = {
    watch: nextWatch,
    focus: hemisphere.focus,
    experience: [...hemisphere.experience, segment],
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
