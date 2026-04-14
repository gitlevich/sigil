/**
 * Co-occurrence extraction from sigil text.
 *
 * Walks the sigil tree, splits text into sentences, finds which @references
 * co-occur in each sentence. Produces a co-occurrence count map: pairs of
 * sigil names mapped to how many sentences they share.
 *
 * This is the data that CoOccurrenceGeometry uses to compute distances
 * in ContrastSpace: distance = inverse co-occurrence.
 */

import type { Sigil } from "./types";
import { allRefsPattern, isInCodeSpan } from "./refs-pattern";
import { resolve } from "./lexicalScope";

/** A pair key: sorted alphabetically so (A,B) and (B,A) are the same entry. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** Split text into sentences. Splits on period/question/exclamation followed by whitespace or end. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

/** Extract resolved @reference names from a sentence. */
function extractRefs(
  sentence: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies?: Sigil | null,
): string[] {
  const names: string[] = [];
  const pattern = new RegExp(allRefsPattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sentence)) !== null) {
    if (isInCodeSpan(sentence, m.index)) continue;
    const token = m[0];
    if (!token.startsWith("@")) continue;
    const resolved = resolve(root, currentPath, token, importedOntologies);
    if (resolved) {
      names.push(resolved.target.name);
    }
  }
  return [...new Set(names)];
}

/** Co-occurrence counts between pairs of sigil names. */
export interface CoOccurrenceMap {
  /** Map from pair key ("A\0B") to sentence count. */
  pairs: Map<string, number>;
  /** All sigil names that appeared in at least one reference. */
  names: Set<string>;
}

/** Parse a pair key back into two names. */
export function parsePairKey(key: string): [string, string] {
  const [a, b] = key.split("\0");
  return [a, b];
}

/** Get the co-occurrence count between two sigils. */
export function coOccurrenceCount(map: CoOccurrenceMap, a: string, b: string): number {
  return map.pairs.get(pairKey(a, b)) ?? 0;
}

/** Compute co-occurrence distance: inverse co-occurrence count. Never co-occurred = Infinity. */
export function coOccurrenceDistance(map: CoOccurrenceMap, a: string, b: string): number {
  const count = coOccurrenceCount(map, a, b);
  return count === 0 ? Infinity : 1 / count;
}

/**
 * Walk the sigil tree and extract co-occurrence data from all text content.
 * Processes language.md, affordance, and invariant text at each sigil.
 */
export function extractCoOccurrences(
  root: Sigil,
  importedOntologies?: Sigil | null,
): CoOccurrenceMap {
  const pairs = new Map<string, number>();
  const names = new Set<string>();

  function processSentence(sentence: string, currentPath: string[]) {
    const refs = extractRefs(sentence, root, currentPath, importedOntologies);
    for (const name of refs) {
      names.add(name);
    }
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const key = pairKey(refs[i], refs[j]);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  function processText(text: string, currentPath: string[]) {
    if (!text.trim()) return;
    for (const sentence of splitSentences(text)) {
      processSentence(sentence, currentPath);
    }
  }

  function walk(sigil: Sigil, path: string[]) {
    if (sigil.isImported) return;
    names.add(sigil.name);
    processText(sigil.language, path);
    for (const aff of sigil.affordances) {
      processText(aff.content, path);
    }
    for (const inv of sigil.invariants) {
      processText(inv.content, path);
    }
    for (const child of sigil.children) {
      walk(child, [...path, child.name]);
    }
  }

  walk(root, []);
  return { pairs, names };
}
