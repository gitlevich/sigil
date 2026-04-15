/**
 * ContinuousAttention — watches SigilSpace for geometric disturbance.
 *
 * Spec affordance: RightHemisphere#continuous-attention
 * Watches the ContrastSpace for changes — re-embeds what the user modified,
 * compares geometry to what it was. When a stable pattern breaks, the distance
 * tells it something moved. It doesn't need to understand why. It senses the
 * disturbance.
 *
 * Pure functions. No timers, no subscriptions, no side effects.
 * Something upstream calls `attend` when a sigil changes. This module returns
 * the signal. The wiring comes later.
 *
 * Spec invariants enforced:
 *   !always-on — no cold start; caller builds the initial space at startup
 *   !semantic-stability — operates on co-occurrence geometry, never raw text
 *   !conceptual-salience — structural breaks produce higher displacement than
 *     surface rewrites (inherent: co-occurrence only changes when references change)
 */
import type { SigilSpace } from "./sigilSpace";
import { displacement } from "./sigilSpace";

// ── Types ──

/** A single sigil's displacement signal. */
export interface DisplacedSigil {
  name: string;
  magnitude: number;
}

/** The disturbance produced by one edit cycle. */
export interface Disturbance {
  /** Sigils whose co-occurrence geometry changed, sorted by magnitude descending. */
  displaced: DisplacedSigil[];
  /** Sum of all displacements — the total geometric shift. */
  total: number;
}

/** Persistent state across invocations. Held by the caller, passed back in. */
export interface Watch {
  /** The space as it was before the latest change. */
  previous: SigilSpace;
  /** Recent disturbance totals for noise floor adaptation. */
  history: number[];
}

// ── Constants ──

/** How many recent disturbances to keep for noise floor calculation. */
const HISTORY_WINDOW = 20;

/** Minimum noise floor — even in a silent workspace, trivial edits don't escalate. */
const MIN_NOISE_FLOOR = 1;

// ── Public API ──

/**
 * Create the initial watch state. Call this at startup with the first SigilSpace.
 *
 * Spec invariant: !always-on — attending from the moment the app opens.
 */
export function init(space: SigilSpace): Watch {
  return { previous: space, history: [] };
}

/**
 * Sense disturbance between the previous space and the current one.
 *
 * Returns the disturbance signal and the updated watch state.
 * The caller decides what to do with the signal — this function just senses.
 */
export function attend(watch: Watch, current: SigilSpace): [Disturbance, Watch] {
  const displaced: DisplacedSigil[] = [];

  // Check every sigil that exists in either space
  const allNames = new Set([
    ...watch.previous.nodes.keys(),
    ...current.nodes.keys(),
  ]);

  for (const name of allNames) {
    const mag = displacement(watch.previous, current, name);
    if (mag > 0) {
      displaced.push({ name, magnitude: mag });
    }
  }

  displaced.sort((a, b) => b.magnitude - a.magnitude);
  const total = displaced.reduce((sum, d) => sum + d.magnitude, 0);

  const disturbance: Disturbance = { displaced, total };

  // Slide the history window forward
  const history = [...watch.history, total].slice(-HISTORY_WINDOW);
  const nextWatch: Watch = { previous: current, history };

  return [disturbance, nextWatch];
}

/**
 * Adaptive noise floor — the baseline level of disturbance in this workspace.
 *
 * Spec invariant (Gate): !amplitude-threshold — threshold adapts to baseline noise.
 * A workspace with heavy editing has a higher floor than a quiet one.
 *
 * Uses the median of recent disturbances. Median is robust to outliers —
 * one large structural break doesn't inflate the floor for subsequent edits.
 */
export function noiseFloor(watch: Watch): number {
  if (watch.history.length === 0) return MIN_NOISE_FLOOR;
  const sorted = [...watch.history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  return Math.max(median, MIN_NOISE_FLOOR);
}

/**
 * Did this disturbance cross the noise floor?
 *
 * This is the gate's amplitude check — not the full escalation decision,
 * just whether the signal is above the noise. The CorpusCallosum does the rest.
 */
export function crosses(disturbance: Disturbance, floor: number): boolean {
  return disturbance.total > floor;
}
