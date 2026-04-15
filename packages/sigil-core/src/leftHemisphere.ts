/**
 * LeftHemisphere — resolution amplification through compression.
 *
 * Spec path: DesignPartner/BicameralMind/LeftHemisphere
 *
 * A flashlight, not a thinker. Receives a compressed signal from the
 * CorpusCallosum (a Resolution), generates along that beam at full
 * resolution within the vocabulary of the recognized sigil.
 *
 * Invariants:
 *   !stateless — retains nothing between invocations
 *   !vocabulary-bounded — generates within the lexical scope of the sigil
 *   !output-in-world — results are written into sigils, Memory, or Spellbook
 *
 * This module builds the prompt and parses the response. The actual LLM
 * call is the caller's responsibility. Pure functions, no I/O.
 */
import type { Sigil } from "./types";
import type { SigilSpace, Vocabulary } from "./sigilSpace";
import type { Resolution } from "./narration";

// ── Types ──

/** What the LeftHemisphere receives from the CorpusCallosum. */
export interface Invocation {
  /** The sigil the user is focused on. */
  focus: string;
  /** The resolved disturbance — what changed and how. */
  resolution: Resolution;
  /** The vocabulary of the focused sigil — its affordances and invariants. */
  vocabulary: Vocabulary;
  /** Vocabularies of neighboring sigils in scope. */
  scope: Vocabulary[];
  /** The focused sigil's language text, for context. */
  language: string;
}

/** What the LeftHemisphere produces. */
export interface Articulation {
  /** What the LeftHemisphere observed about the disturbance. */
  observation: string;
  /** Suggested actions, if any — phrased in the sigil's vocabulary. */
  suggestions: string[];
  /** Whether the shape needs further attention (for map-check). */
  needsAttention: boolean;
}

// ── Prompt construction ──

/**
 * Build an Invocation from the current state.
 *
 * Gathers the focused sigil's vocabulary and its neighbors' vocabularies
 * from the SigilSpace. This is the !vocabulary-bounded scope.
 */
export function buildInvocation(
  root: Sigil,
  space: SigilSpace,
  resolution: Resolution,
  focusName: string,
): Invocation | null {
  const focusNode = space.nodes.get(focusName);
  if (!focusNode) return null;

  // Gather neighbor vocabularies — the lexical scope
  const scope: Vocabulary[] = [];
  for (const edge of focusNode.edges.slice(0, 10)) {
    const neighbor = space.nodes.get(edge.target);
    if (neighbor) scope.push(neighbor.vocabulary);
  }

  // Find the focus sigil in the tree to get its language text
  const focusSigil = findSigil(root, focusName);
  const language = focusSigil?.language ?? "";

  return {
    focus: focusName,
    resolution,
    vocabulary: focusNode.vocabulary,
    scope,
    language,
  };
}

/**
 * Render an Invocation as a prompt string for the LLM.
 *
 * !stateless — the prompt contains everything the LLM needs.
 * !vocabulary-bounded — only sigils in scope are included.
 */
export function renderPrompt(invocation: Invocation): string {
  const lines: string[] = [];

  lines.push("You are the LeftHemisphere of a bicameral design partner.");
  lines.push("You receive a compressed signal about a structural disturbance in a sigil specification.");
  lines.push("Your job: observe what changed, assess whether it matters, and suggest actions if needed.");
  lines.push("Generate ONLY within the vocabulary provided. Do not invent new concepts.");
  lines.push("");

  lines.push(`## Focus: ${invocation.focus}`);
  lines.push("");
  if (invocation.language) {
    lines.push("### Language");
    lines.push(invocation.language);
    lines.push("");
  }

  lines.push("### Vocabulary");
  lines.push(`Affordances: ${invocation.vocabulary.affordances.join(", ") || "(none)"}`);
  lines.push(`Invariants: ${invocation.vocabulary.invariants.join(", ") || "(none)"}`);
  lines.push("");

  if (invocation.scope.length > 0) {
    lines.push("### Neighboring sigils in scope");
    for (const v of invocation.scope) {
      const parts = [`${v.name}`];
      if (v.affordances.length > 0) parts.push(`affordances: ${v.affordances.join(", ")}`);
      if (v.invariants.length > 0) parts.push(`invariants: ${v.invariants.join(", ")}`);
      lines.push(`- ${parts.join(" | ")}`);
    }
    lines.push("");
  }

  lines.push("## Disturbance");
  lines.push(invocation.resolution.summary);
  lines.push("");
  for (const change of invocation.resolution.changes) {
    lines.push(`- ${change.description} (${change.kind}, magnitude ${change.magnitude})`);
  }
  lines.push("");

  lines.push("## Instructions");
  lines.push("Respond in JSON with this shape:");
  lines.push("```json");
  lines.push('{ "observation": "...", "suggestions": ["..."], "needsAttention": true/false }');
  lines.push("```");
  lines.push("- observation: one paragraph describing what the disturbance means for this sigil");
  lines.push("- suggestions: 0-3 concrete actions using only vocabulary from the scope above");
  lines.push("- needsAttention: true if the shape is degraded and needs more work");

  return lines.join("\n");
}

/**
 * Parse the LLM's response into an Articulation.
 *
 * Extracts JSON from the response, falling back to a simple observation
 * if the response isn't valid JSON.
 */
export function parseResponse(response: string): Articulation {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        observation: typeof parsed.observation === "string" ? parsed.observation : response,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: unknown) => typeof s === "string") : [],
        needsAttention: typeof parsed.needsAttention === "boolean" ? parsed.needsAttention : false,
      };
    } catch {
      // Fall through to plain text
    }
  }

  return {
    observation: response.trim(),
    suggestions: [],
    needsAttention: false,
  };
}

// ── Helpers ──

function findSigil(sigil: Sigil, name: string): Sigil | null {
  if (sigil.name === name) return sigil;
  for (const child of sigil.children) {
    const found = findSigil(child, name);
    if (found) return found;
  }
  return null;
}
