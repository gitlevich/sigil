/**
 * BicameralMind — the full McGilchrist cycle.
 *
 * Spec path: DesignPartner/BicameralMind
 *
 * Orchestrates the cycle: RightHemisphere perceives → CorpusCallosum
 * filters and narrates → Gate decides → LeftHemisphere articulates →
 * map-check → repeat or yield.
 *
 * Pure state machine. The caller provides the LLM as a function.
 * No I/O, no timers, no side effects.
 */
import type { Sigil } from "./types";
import { build } from "./sigilSpace";
import type { Hemisphere, Perception, ExperienceSegment } from "./rightHemisphere";
import {
  open as openHemisphere,
  focusOn,
  perceive as rhPerceive,
} from "./rightHemisphere";
import type { GateState } from "./gate";
import { init as initGate, evaluate, step, forceYield } from "./gate";
import { buildInvocation, renderPrompt, parseResponse } from "./leftHemisphere";
import type { Invocation, Articulation } from "./leftHemisphere";

// ── Types ──

/** The full mind state. */
export interface Mind {
  hemisphere: Hemisphere;
  gate: GateState;
}

/** What the cycle produces after perceiving a change. */
export interface CycleResult {
  /** The raw perception from the RightHemisphere. */
  perception: Perception;
  /** If the Gate passed: the invocation built for the LeftHemisphere. */
  invocation: Invocation | null;
  /** If the Gate passed: the rendered prompt for the LLM. */
  prompt: string | null;
  /** If the Gate suppressed: the reason. */
  suppressedReason: string | null;
}

/** What a LeftHemisphere turn produces. */
export interface TurnResult {
  articulation: Articulation;
  /** Whether the Gate granted another step. */
  continues: boolean;
  /** Next prompt if continues is true. */
  nextPrompt: string | null;
}

// ── Public API ──

/** Initialize the bicameral mind. */
export function open(root: Sigil, importedOntologies?: Sigil | null): Mind {
  return {
    hemisphere: openHemisphere(root, importedOntologies),
    gate: initGate(),
  };
}

/** Set focus. */
export function focus(mind: Mind, sigilName: string): Mind {
  return { ...mind, hemisphere: focusOn(mind.hemisphere, sigilName) };
}

/**
 * Perceive a change and run through the CorpusCallosum.
 *
 * Returns a CycleResult with either an invocation+prompt (if the Gate passed)
 * or a suppression reason (if the Gate filtered the signal).
 *
 * The caller is responsible for calling the LLM with the prompt and feeding
 * the response back via `completeTurn`.
 */
export function perceive(
  mind: Mind,
  root: Sigil,
  changedSigils: string[],
  timestamp: number,
  importedOntologies?: Sigil | null,
): [CycleResult, Mind] {
  const [perception, nextHemisphere] = rhPerceive(
    mind.hemisphere, root, changedSigils, timestamp, importedOntologies,
  );

  let nextMind: Mind = { hemisphere: nextHemisphere, gate: mind.gate };

  // No disturbance — no escalation path
  if (!perception.escalation || !perception.experience.resolution) {
    return [{
      perception,
      invocation: null,
      prompt: null,
      suppressedReason: perception.escalation ? null : "No disturbance.",
    }, nextMind];
  }

  // Gate evaluation — coherence check placeholder (always false = shape is broken)
  // TODO: real coherence sensing from RightHemisphere/Coherence
  const coherenceOk = false;
  const [decision, nextGate] = evaluate(
    mind.gate,
    perception.experience.resolution,
    timestamp,
    coherenceOk,
  );
  nextMind = { ...nextMind, gate: nextGate };

  if (decision.action === "suppress") {
    return [{
      perception,
      invocation: null,
      prompt: null,
      suppressedReason: decision.reason,
    }, nextMind];
  }

  // Gate passed — build the LeftHemisphere invocation
  const currentSpace = build(root, importedOntologies);
  const focusName = nextHemisphere.focus ?? root.name;
  const invocation = buildInvocation(root, currentSpace, perception.experience.resolution, focusName);

  if (!invocation) {
    nextMind = { ...nextMind, gate: forceYield(nextMind.gate) };
    return [{
      perception,
      invocation: null,
      prompt: null,
      suppressedReason: "Could not build invocation — focus sigil not found.",
    }, nextMind];
  }

  const prompt = renderPrompt(invocation);

  return [{
    perception,
    invocation,
    prompt,
    suppressedReason: null,
  }, nextMind];
}

/**
 * Complete a LeftHemisphere turn with the LLM's response.
 *
 * Parses the response, runs the map-check (re-senses the space after
 * the LH's output was applied), and decides whether to continue.
 *
 * !bounded-turn — the Gate enforces the step cap.
 * !map-check — coherence is re-sensed after each step.
 */
export function completeTurn(
  mind: Mind,
  llmResponse: string,
  root: Sigil,
  importedOntologies?: Sigil | null,
): [TurnResult, Mind] {
  const articulation = parseResponse(llmResponse);

  // Map-check: did the shape improve?
  // For now, use the LH's own assessment (!needsAttention means shape improved).
  // TODO: real map-check via RightHemisphere re-sensing
  const coherenceImproved = !articulation.needsAttention;

  const [turnDecision, nextGate] = step(mind.gate, coherenceImproved);
  const nextMind: Mind = { ...mind, gate: nextGate };

  if (turnDecision.action === "yield") {
    return [{
      articulation,
      continues: false,
      nextPrompt: null,
    }, nextMind];
  }

  // Gate granted another step — rebuild prompt with current state
  const currentSpace = build(root, importedOntologies);
  const focusName = mind.hemisphere.focus ?? root.name;
  // Re-use the last resolution for continuation
  const lastExp = mind.hemisphere.experience[mind.hemisphere.experience.length - 1];
  if (!lastExp?.resolution) {
    return [{
      articulation,
      continues: false,
      nextPrompt: null,
    }, { ...nextMind, gate: forceYield(nextMind.gate) }];
  }

  const invocation = buildInvocation(root, currentSpace, lastExp.resolution, focusName);
  const nextPrompt = invocation ? renderPrompt(invocation) : null;

  return [{
    articulation,
    continues: nextPrompt !== null,
    nextPrompt,
  }, nextMind];
}

/** Get the experience stream. */
export function experience(mind: Mind): ExperienceSegment[] {
  return mind.hemisphere.experience;
}
