/**
 * Extract labeled arcs between @Children co-occurring in the same sentence
 * of a sigil's @language. Feeds the Spatial desktop so the prose itself
 * provides layout signal.
 */

/** One arc connects two child-by-name, labeled with the index and text of the enclosing unit (sentence or paragraph). */
export interface SentenceArc {
  a: string;       // child name
  b: string;       // child name
  sentenceIndex: number;
  sentence: string;
}

/** Granularity at which @Children are considered co-occurring. */
export type ArcScope = "sentence" | "paragraph";

/**
 * Split a block of markdown into sentences. Front matter, code fences, and
 * headings are treated as their own units so a heading containing @refs
 * doesn't glue into a following paragraph.
 */
export function splitSentences(text: string): string[] {
  // Strip YAML frontmatter.
  let body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  // Drop fenced code blocks — refs inside them shouldn't form arcs.
  body = body.replace(/```[\s\S]*?```/g, " ");
  // Normalize line endings.
  body = body.replace(/\r\n/g, "\n");
  // Insert a sentence-break marker at headings so they don't fuse.
  body = body.replace(/^#+\s+.*$/gm, (m) => m + ".");
  // Split on .!? followed by whitespace or end, plus blank-line boundaries.
  const raw = body.split(/(?<=[.!?])\s+|\n{2,}/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Split text into paragraphs. Blank lines separate; front matter and code
 * fences are removed (same hygiene as splitSentences).
 */
export function splitParagraphs(text: string): string[] {
  let body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  body = body.replace(/```[\s\S]*?```/g, " ");
  body = body.replace(/\r\n/g, "\n");
  return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Find all arcs among the provided child names in the given text, at the chosen scope. */
export function extractArcs(text: string, childNames: string[], scope: ArcScope = "sentence"): SentenceArc[] {
  if (childNames.length < 2) return [];
  const childSet = new Set(childNames);
  const units = scope === "paragraph" ? splitParagraphs(text) : splitSentences(text);
  const arcs: SentenceArc[] = [];
  const refRe = /@([A-Za-z][A-Za-z0-9_]*)/g;
  units.forEach((unit, i) => {
    refRe.lastIndex = 0;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = refRe.exec(unit)) !== null) {
      const name = match[1];
      if (childSet.has(name)) seen.add(name);
    }
    if (seen.size < 2) return;
    const names = [...seen].sort();
    for (let x = 0; x < names.length; x++) {
      for (let y = x + 1; y < names.length; y++) {
        arcs.push({ a: names[x], b: names[y], sentenceIndex: i, sentence: unit });
      }
    }
  });
  return arcs;
}

/** A short, at-a-glance label for an arc: first ~40 chars of the sentence. */
export function arcLabel(sentence: string, maxLen = 40): string {
  const trimmed = sentence.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1).trimEnd() + "\u2026";
}
