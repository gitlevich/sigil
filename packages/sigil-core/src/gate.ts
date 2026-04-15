/**
 * Gate — the decision mechanism of the CorpusCallosum.
 *
 * Spec path: DesignPartner/BicameralMind/CorpusCallosum/Gate
 *
 * Decides when a signal from the RightHemisphere is strong enough to
 * warrant escalation to the LeftHemisphere. Filters noise, enforces
 * bounded turns, checks coherence before and after.
 *
 * Invariants:
 *   !amplitude-threshold — signal must exceed adaptive noise floor
 *   !frequency-filtering — rapid flurries are noise; only settled shifts pass
 *   !gate-authority — LH never self-invokes; only the gate escalates
 *   !bounded-turn — LH gets a fixed number of steps, then yields
 *   !map-check — RH re-senses after every LH turn
 *   !coherence-precedence — coherence is read before any escalation
 *
 * Pure state machine. The caller drives the cycle.
 */
import type { Resolution } from "./narration";

// ── Types ──

/** Gate state, threaded through by the caller. */
export interface GateState {
  /** Timestamps of recent escalation-worthy signals, for frequency filtering. */
  recentSignals: number[];
  /** Whether the LeftHemisphere is currently in a turn. */
  leftHemisphereActive: boolean;
  /** How many steps the LeftHemisphere has taken in the current turn. */
  turnSteps: number;
}

/** The gate's decision on an incoming signal. */
export type GateDecision =
  | { action: "pass"; resolution: Resolution }
  | { action: "suppress"; reason: string };

/** The gate's decision after a LeftHemisphere turn completes. */
export type TurnDecision =
  | { action: "continue"; reason: string }
  | { action: "yield"; reason: string };

// ── Constants ──

/** Minimum interval between escalations (ms). !frequency-filtering. */
const MIN_SIGNAL_INTERVAL = 2000;

/** How many recent signals to track for frequency filtering. */
const SIGNAL_WINDOW = 10;

/** Maximum steps per LeftHemisphere turn. !bounded-turn. */
const MAX_TURN_STEPS = 5;

// ── Public API ──

/** Create initial gate state. */
export function init(): GateState {
  return {
    recentSignals: [],
    leftHemisphereActive: false,
    turnSteps: 0,
  };
}

/**
 * Evaluate whether a disturbance should be escalated.
 *
 * The caller has already: (1) computed displacement via RightHemisphere,
 * (2) checked amplitude threshold via `crosses`, (3) resolved via Narration.
 * The gate applies frequency filtering and coherence precedence.
 *
 * !gate-authority — this is the only path to the LeftHemisphere.
 * !coherence-precedence — the caller must provide a coherence signal.
 * !frequency-filtering — rapid signals are suppressed.
 */
export function evaluate(
  state: GateState,
  resolution: Resolution,
  timestamp: number,
  coherenceOk: boolean,
): [GateDecision, GateState] {
  // !frequency-filtering — suppress if signals are arriving too fast
  const recentCount = state.recentSignals.filter(
    t => timestamp - t < MIN_SIGNAL_INTERVAL,
  ).length;

  if (recentCount >= 3) {
    return [
      { action: "suppress", reason: "Rapid signal flurry — shape hasn't settled." },
      state,
    ];
  }

  // !coherence-precedence — don't escalate if the shape is coherent
  if (coherenceOk) {
    return [
      { action: "suppress", reason: "Shape is coherent — sparseness alone is not a reason to escalate." },
      state,
    ];
  }

  // !gate-authority — LH is already active, don't interrupt
  if (state.leftHemisphereActive) {
    return [
      { action: "suppress", reason: "LeftHemisphere is in a turn — wait for yield." },
      state,
    ];
  }

  // Signal passes — escalate
  const nextSignals = [...state.recentSignals, timestamp].slice(-SIGNAL_WINDOW);
  const nextState: GateState = {
    recentSignals: nextSignals,
    leftHemisphereActive: true,
    turnSteps: 0,
  };

  return [{ action: "pass", resolution }, nextState];
}

/**
 * Record a LeftHemisphere step and check if the turn should continue.
 *
 * !bounded-turn — yields after MAX_TURN_STEPS regardless.
 * !map-check — the caller must re-sense coherence and pass it in.
 */
export function step(
  state: GateState,
  coherenceImproved: boolean,
): [TurnDecision, GateState] {
  if (!state.leftHemisphereActive) {
    return [
      { action: "yield", reason: "No active turn." },
      state,
    ];
  }

  const nextSteps = state.turnSteps + 1;

  // !bounded-turn — hard cap
  if (nextSteps >= MAX_TURN_STEPS) {
    return [
      { action: "yield", reason: "Turn cap reached." },
      { ...state, leftHemisphereActive: false, turnSteps: 0 },
    ];
  }

  // !map-check — did the shape improve?
  if (!coherenceImproved) {
    return [
      { action: "yield", reason: "Shape did not improve — yielding." },
      { ...state, leftHemisphereActive: false, turnSteps: 0 },
    ];
  }

  return [
    { action: "continue", reason: "Shape improved — another step." },
    { ...state, turnSteps: nextSteps },
  ];
}

/**
 * Force the LeftHemisphere to yield. Safety valve.
 */
export function forceYield(state: GateState): GateState {
  return { ...state, leftHemisphereActive: false, turnSteps: 0 };
}
