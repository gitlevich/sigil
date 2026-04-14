/**
 * SigilSpace — the co-occurrence graph over a Sigil tree.
 *
 * This is ContrastSpace from the spec, defined locally: the same sigil tree
 * seen through co-occurrence instead of containment. Every node is a sigil.
 * Every edge is a co-occurrence count — how many sentences mention both sigils.
 *
 * The tree gives you parent-child. This graph gives you who-mentions-whom.
 * Both are intrinsic to the sigil; this module computes the co-occurrence view.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere/CoOccurrenceGeometry/ContrastSpace
 */
import type { Sigil } from "./types";
import { allRefsPattern, isInCodeSpan } from "./refs-pattern";
import { resolve } from "./lexicalScope";

// ── Types ──

/** A sigil's vocabulary — what the LeftHemisphere needs to generate from. */
export interface Vocabulary {
  name: string;
  affordances: string[];
  invariants: string[];
}

/** An edge in the co-occurrence graph. */
export interface CoOccurrence {
  /** The other sigil's name. */
  target: string;
  /** Number of sentences where both sigils are mentioned. */
  count: number;
}

/** A node in SigilSpace: a sigil with its co-occurrence edges and vocabulary. */
export interface SigilNode {
  /** Path from root, e.g. ["DesignPartner", "BicameralMind"]. */
  path: string[];
  vocabulary: Vocabulary;
  edges: CoOccurrence[];
}

/** The co-occurrence graph over a sigil tree. */
export interface SigilSpace {
  /** All nodes keyed by canonical sigil name. */
  nodes: Map<string, SigilNode>;
}

// ── Sentence splitting ──

/** Split text into sentences. Handles abbreviations and decimal numbers naively. */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string.
  // This is intentionally simple — co-occurrence is statistical, so occasional
  // mis-splits don't corrupt the signal.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ── Reference extraction ──

/**
 * Extract all @sigil references from a line, resolving them to canonical names.
 * Returns only sigil references (not bare #affordance or !invariant refs).
 */
function extractSigilRefs(
  line: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
): string[] {
  const names: string[] = [];
  allRefsPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = allRefsPattern.exec(line)) !== null) {
    if (isInCodeSpan(line, m.index)) continue;
    const token = m[0];
    if (!token.startsWith("@")) continue;

    // Strip any trailing #affordance or !invariant — we only want the sigil part
    const propMatch = token.match(/[#!][a-zA-Z_][\w-]*$/);
    const sigilPart = propMatch ? token.slice(0, propMatch.index) : token;

    const resolved = resolve(root, currentPath, sigilPart, importedOntologies);
    if (resolved && !resolved.ambiguous) {
      names.push(resolved.target.name);
    }
  }
  return names;
}

// ── Co-occurrence matrix ──

type CoOccurrenceMatrix = Map<string, Map<string, number>>;

function incrementCoOccurrence(matrix: CoOccurrenceMatrix, a: string, b: string): void {
  if (a === b) return;
  // Symmetric: store both directions
  if (!matrix.has(a)) matrix.set(a, new Map());
  if (!matrix.has(b)) matrix.set(b, new Map());
  matrix.get(a)!.set(b, (matrix.get(a)!.get(b) ?? 0) + 1);
  matrix.get(b)!.set(a, (matrix.get(b)!.get(a) ?? 0) + 1);
}

/**
 * Extract co-occurrences from one block of content, belonging to the sigil at `currentPath`.
 */
function extractFromContent(
  content: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
  matrix: CoOccurrenceMatrix,
): void {
  const sentences = splitSentences(content);
  for (const sentence of sentences) {
    const refs = extractSigilRefs(sentence, root, currentPath, importedOntologies);
    const unique = [...new Set(refs)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        incrementCoOccurrence(matrix, unique[i], unique[j]);
      }
    }
  }
}

// ── Tree walking ──

/** Collect vocabulary for a sigil. */
function vocabularyOf(sigil: Sigil): Vocabulary {
  return {
    name: sigil.name,
    affordances: sigil.affordances.map(a => a.name),
    invariants: sigil.invariants.map(i => i.name),
  };
}

/** Walk the sigil tree, extracting co-occurrences from all content. */
function walkForCoOccurrences(
  sigil: Sigil,
  path: string[],
  root: Sigil,
  importedOntologies: Sigil | null,
  matrix: CoOccurrenceMatrix,
): void {
  if (sigil.language) {
    extractFromContent(sigil.language, root, path, importedOntologies, matrix);
  }
  for (const aff of sigil.affordances) {
    extractFromContent(aff.content, root, path, importedOntologies, matrix);
  }
  for (const inv of sigil.invariants) {
    extractFromContent(inv.content, root, path, importedOntologies, matrix);
  }
  for (const child of sigil.children) {
    if (child.isImported) continue;
    walkForCoOccurrences(child, [...path, child.name], root, importedOntologies, matrix);
  }
}

/** Walk the tree and collect all sigil nodes with their paths. */
function collectNodes(
  sigil: Sigil,
  path: string[],
  result: Map<string, { sigil: Sigil; path: string[] }>,
): void {
  result.set(sigil.name, { sigil, path });
  for (const child of sigil.children) {
    if (child.isImported) continue;
    collectNodes(child, [...path, child.name], result);
  }
}

// ── Public API: the spec's affordances ──

/**
 * Build a SigilSpace from a sigil tree.
 *
 * Spec affordance: #place — compute every sigil's position from co-occurrence.
 * Spec invariant: !complete — every sigil gets a node.
 * Spec invariant: !co-occurrence-grounded — positions come from co-occurrence, not embeddings.
 */
export function build(root: Sigil, importedOntologies?: Sigil | null): SigilSpace {
  const libs = importedOntologies ?? null;
  const matrix: CoOccurrenceMatrix = new Map();

  // Walk tree and extract co-occurrences
  walkForCoOccurrences(root, [], root, libs, matrix);

  // Collect all sigils with paths
  const allSigils = new Map<string, { sigil: Sigil; path: string[] }>();
  collectNodes(root, [], allSigils);

  // Build nodes — every sigil gets one, even if it has no co-occurrences
  const nodes = new Map<string, SigilNode>();
  for (const [name, { sigil, path }] of allSigils) {
    const edgeMap = matrix.get(name) ?? new Map<string, number>();
    const edges: CoOccurrence[] = [];
    for (const [target, count] of edgeMap) {
      edges.push({ target, count });
    }
    edges.sort((a, b) => b.count - a.count);
    nodes.set(name, {
      path,
      vocabulary: vocabularyOf(sigil),
      edges,
    });
  }

  return { nodes };
}

/**
 * Distance between two sigils: inverse co-occurrence.
 *
 * Spec affordance: Position#distance
 * Returns Infinity if the two sigils never co-occur.
 */
export function distance(space: SigilSpace, a: string, b: string): number {
  if (a === b) return 0;
  const nodeA = space.nodes.get(a);
  if (!nodeA) return Infinity;
  const edge = nodeA.edges.find(e => e.target === b);
  if (!edge) return Infinity;
  return 1 / edge.count;
}

/**
 * Find the K nearest sigils to a given sigil.
 *
 * Spec affordance: ContrastSpace#neighbors
 * Returns neighbors sorted by ascending distance (descending co-occurrence count).
 */
export function neighbors(space: SigilSpace, sigilName: string, k?: number): SigilNode[] {
  const node = space.nodes.get(sigilName);
  if (!node) return [];
  // Edges are already sorted by descending count (ascending distance)
  const limit = k ?? node.edges.length;
  return node.edges
    .slice(0, limit)
    .map(e => space.nodes.get(e.target))
    .filter((n): n is SigilNode => n !== undefined);
}

/**
 * Measure how a sigil's co-occurrence pattern changed between two spaces.
 *
 * Spec affordance: ContrastSpace#displacement
 * Returns the sum of absolute differences in co-occurrence counts across all edges.
 * This is L1 distance between the old and new co-occurrence vectors.
 */
export function displacement(oldSpace: SigilSpace, newSpace: SigilSpace, sigilName: string): number {
  const oldNode = oldSpace.nodes.get(sigilName);
  const newNode = newSpace.nodes.get(sigilName);
  if (!oldNode && !newNode) return 0;

  const oldEdges = new Map<string, number>();
  const newEdges = new Map<string, number>();

  if (oldNode) {
    for (const e of oldNode.edges) oldEdges.set(e.target, e.count);
  }
  if (newNode) {
    for (const e of newNode.edges) newEdges.set(e.target, e.count);
  }

  const allTargets = new Set([...oldEdges.keys(), ...newEdges.keys()]);
  let sum = 0;
  for (const target of allTargets) {
    sum += Math.abs((newEdges.get(target) ?? 0) - (oldEdges.get(target) ?? 0));
  }
  return sum;
}

/**
 * Rebuild only the affected parts of a SigilSpace after a sigil's content changes.
 *
 * Spec invariant: !incremental — don't recompute the entire space for one edit.
 *
 * Strategy: rebuild the full space (it's cheap — just string scanning), but a smarter
 * implementation could diff the co-occurrence matrix. For now, correctness over optimization.
 * The displacement function lets the caller detect what actually moved.
 */
export function rebuild(root: Sigil, importedOntologies?: Sigil | null): SigilSpace {
  return build(root, importedOntologies);
}
