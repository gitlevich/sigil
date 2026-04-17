/**
 * Sigil compression — the spec flattened to a narrative that fits a small
 * model's working context.
 *
 * Spec path: infrastructure for DesignPartner/Attention; not itself a sigil.
 *
 * Each sigil's language.md opens with its thesis — usually one or two
 * sentences that say what this sigil is. The compressor extracts those
 * thesis lines and weaves them into connected prose that walks the tree,
 * so every root-to-leaf path is expressible by following the narrative.
 *
 * Image compression keeps structure and drops perceptual noise; this
 * drops the body of each sigil (the full language, affordances with
 * content, invariants with content) and keeps the structural thesis.
 * Compression along the @Relevance axis.
 *
 * Pure function. Caller caches the result and regenerates on tree-structure
 * change.
 */
import type { Sigil } from "./types";
import { stripFrontmatter } from "./frontmatter";

/** Compress a sigil tree into a narrative paragraph. */
export function compressSigil(root: Sigil): string {
  const lines: string[] = [];
  emitSigil(root, lines, 0);
  return lines.join("\n");
}

function emitSigil(sigil: Sigil, out: string[], depth: number): void {
  const thesis = extractThesis(sigil.language);
  const affordanceNames = sigil.affordances.map((a) => `#${a.name}`);
  const invariantNames = sigil.invariants.map((i) => `!${i.name}`);
  const childNames = sigil.children.map((c) => `@${c.name}`);

  const indent = "  ".repeat(depth);
  const header = `${indent}@${sigil.name}${thesis ? ": " + thesis : ""}`;
  out.push(header);

  const properties: string[] = [];
  if (affordanceNames.length > 0) {
    properties.push(`affords ${affordanceNames.join(", ")}`);
  }
  if (invariantNames.length > 0) {
    properties.push(`must hold ${invariantNames.join(", ")}`);
  }
  if (childNames.length > 0) {
    properties.push(`contains ${childNames.join(", ")}`);
  }
  if (properties.length > 0) {
    out.push(`${indent}  (${properties.join("; ")})`);
  }

  for (const child of sigil.children) {
    emitSigil(child, out, depth + 1);
  }
}

/**
 * Extract a short thesis from a sigil's language.md content.
 *
 * Strategy: drop frontmatter, drop leading # heading, take the first
 * non-empty sentence. Most sigils in this spec open with a thesis like
 * "I am X. My Y does Z." — first sentence captures the claim.
 */
export function extractThesis(language: string): string {
  const text = stripFrontmatter(language).trim();
  if (!text) return "";

  // Drop a leading markdown heading line if present.
  const withoutHeading = text.startsWith("#")
    ? text.replace(/^#+\s+.*$/m, "").trim()
    : text;
  if (!withoutHeading) return "";

  // First sentence — ends at a period followed by whitespace, or newline,
  // whichever comes first. Keep the period.
  const firstLine = withoutHeading.split(/\n\s*\n/)[0] ?? withoutHeading;
  const match = firstLine.match(/^(.*?[.!?])(\s|$)/);
  const thesis = match ? match[1] : firstLine.split("\n")[0];

  // Collapse internal whitespace and trim.
  return thesis.replace(/\s+/g, " ").trim();
}
