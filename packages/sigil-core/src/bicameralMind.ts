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
import { sense } from "./coherence";
import type { MemoryState, RecognitionResult, ShortTermTrace } from "./memory";
import {
  init as initMemory,
  remember,
  recall,
  consolidate as consolidateMemory,
} from "./memory";
import type { AttentionState } from "./attention";
import {
  init as initAttention,
  anchorTo as anchorAttention,
  walkedPath,
} from "./attention";

// ── Types ──

/** The full mind state. */
export interface Mind {
  hemisphere: Hemisphere;
  gate: GateState;
  memory: MemoryState;
  /** His own attention stream — distinct from the user's focus. */
  attention: AttentionState;
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
  /** Remembered sigils recalled involuntarily near the focus. */
  recalled: RecognitionResult[];
  /** Short-term traces produced by this perceive — caller persists these. */
  traces: ShortTermTrace[];
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
    memory: initMemory(),
    attention: initAttention(),
  };
}

/**
 * Set focus.
 *
 * Two-user model: the @user's focus becomes the anchor for his attention.
 * His attention rides with the @user's by default, and the act of anchoring
 * registers the current focus in his @Path (trajectory).
 */
export function focus(mind: Mind, sigilName: string, timestamp: number): Mind {
  return {
    ...mind,
    hemisphere: focusOn(mind.hemisphere, sigilName),
    attention: anchorAttention(mind.attention, sigilName, timestamp),
  };
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

  const currentSpace = build(root, importedOntologies);
  const focusName = nextHemisphere.focus ?? root.name;

  // Anchor his attention to the current focus, so changes happening while he
  // attends here are eligible for @Memory. His walked @Path gates entry.
  const nextAttention = anchorAttention(mind.attention, focusName, timestamp);

  // #recall — involuntary recognition near the focus
  const recalled = recall(mind.memory, currentSpace, focusName);

  // #remember — only sigils he has been attending to enter @Memory.
  // "What survives @Memory is what was along the current. Not count, not
  //  recency, not utility — pull." (@Relevance) The current filter is
  //  conservative: his attention must touch the sigil. Attraction pulls
  //  that broaden this come later.
  const attendedSet = new Set(walkedPath(nextAttention));
  let nextMemory = mind.memory;
  const traces: ShortTermTrace[] = [];
  for (const name of changedSigils) {
    if (!attendedSet.has(name)) continue;
    const node = currentSpace.nodes.get(name);
    if (node) {
      const [mem, trace] = remember(nextMemory, node, timestamp);
      nextMemory = mem;
      traces.push(trace);
    }
  }

  let nextMind: Mind = {
    hemisphere: nextHemisphere,
    gate: mind.gate,
    memory: nextMemory,
    attention: nextAttention,
  };

  // No disturbance — no escalation path
  if (!perception.escalation || !perception.experience.resolution) {
    return [{
      perception,
      invocation: null,
      prompt: null,
      suppressedReason: perception.escalation ? null : "No disturbance.",
      recalled,
      traces,
    }, nextMind];
  }

  // Gate evaluation — !coherence-precedence: sense the shape before escalating
  const displacedNames = perception.experience.resolution.changes.map(c => c.sigil);
  const coherenceReading = sense(currentSpace, focusName, displacedNames);
  const coherenceOk = coherenceReading.ok;
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
      recalled,
      traces,
    }, nextMind];
  }

  // Gate passed — build the LeftHemisphere invocation
  // Feed recalled vocabulary into the scope so the LH knows what Memory knows
  const invocation = buildInvocation(root, currentSpace, perception.experience.resolution, focusName);

  if (!invocation) {
    nextMind = { ...nextMind, gate: forceYield(nextMind.gate) };
    return [{
      perception,
      invocation: null,
      prompt: null,
      suppressedReason: "Could not build invocation — focus sigil not found.",
      recalled,
      traces,
    }, nextMind];
  }

  // Enrich the LH's scope with recalled vocabulary from Memory
  for (const r of recalled) {
    const alreadyInScope = invocation.scope.some(v => v.name === r.remembered.name);
    if (!alreadyInScope) {
      invocation.scope.push(r.remembered.vocabulary);
    }
  }

  const prompt = renderPrompt(invocation);

  return [{
    perception,
    invocation,
    prompt,
    suppressedReason: null,
    recalled,
    traces,
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

  // !map-check: RightHemisphere re-senses the shape after the LH's output.
  // The caller has already applied the LH's changes to the tree (root).
  // We sense coherence of the current shape to decide if it improved.
  const currentSpace = build(root, importedOntologies);
  const focusName = mind.hemisphere.focus ?? root.name;
  const lastExp = mind.hemisphere.experience[mind.hemisphere.experience.length - 1];
  const displacedNames = lastExp?.resolution?.changes.map(c => c.sigil) ?? [];
  const reading = sense(currentSpace, focusName, displacedNames);
  const coherenceImproved = reading.ok;

  const [turnDecision, nextGate] = step(mind.gate, coherenceImproved);
  const nextMind: Mind = { ...mind, gate: nextGate };

  if (turnDecision.action === "yield") {
    return [{
      articulation,
      continues: false,
      nextPrompt: null,
    }, nextMind];
  }

  // Gate granted another step — reuse currentSpace and lastExp from map-check
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

/** Get the current memory state. */
export { type MemoryState, type RememberedSigil, type RecognitionResult, type ShortTermTrace, type ConsolidationReport } from "./memory";
export function memory(mind: Mind): MemoryState {
  return mind.memory;
}

/** The result of sleep — the mind rested, and the dream report. */
export interface SleepResult {
  mind: Mind;
  report: import("./memory").ConsolidationReport;
}

/**
 * #sleep — consolidate memory from accumulated experience.
 *
 * Collects all sigil names the Subconscious attended to (relevant experience),
 * feeds them into Memory's consolidation. Reinforce → decay → merge → prune.
 *
 * Returns the mind with consolidated memory, cleared experience, and the
 * consolidation report so the caller can record the dream in the experience stream.
 */
export function sleep(
  mind: Mind,
  root: Sigil,
  importedOntologies?: Sigil | null,
): SleepResult {
  const currentSpace = build(root, importedOntologies);

  // Collect attended sigil names from relevant experience
  const attendedNames = new Set<string>();
  for (const seg of mind.hemisphere.experience) {
    if (!seg.relevant) continue;
    for (const name of seg.sigils) attendedNames.add(name);
    if (seg.resolution) {
      for (const c of seg.resolution.changes) attendedNames.add(c.sigil);
    }
  }

  const [nextMemory, report] = consolidateMemory(
    mind.memory,
    [...attendedNames],
    currentSpace,
    Date.now(),
  );

  return {
    mind: {
      ...mind,
      memory: nextMemory,
      hemisphere: {
        ...mind.hemisphere,
        experience: [], // experience is consumed by sleep
      },
    },
    report,
  };
}
