/**
 * Memory — remembered sigils positioned in ContrastSpace.
 *
 * Spec path: DesignPartner/BicameralMind/Memory
 *
 * Two layers:
 *   Short-term — raw traces accumulated in real time during perceive.
 *     Persisted incrementally (JSONL), survives crashes. Cheap, append-only.
 *   Long-term — consolidated residue of many sessions.
 *     Produced by #sleep (consolidation). Reinforced, merged, decayed, pruned.
 *     Persisted as a snapshot on sleep. Loaded on startup.
 *
 * Recognition searches both: long-term first (stronger, more refined),
 * short-term supplements (recent, not yet consolidated).
 *
 * Invariants:
 *   !geometric-storage — every remembered sigil has a position and vocabulary
 *   !reliable — recognized while reinforced through use
 *   !lossy — what has no relevance fades through passive decay
 *
 * Pure functions. No I/O. The caller persists.
 */
import type { SigilSpace, SigilNode, Vocabulary, CoOccurrence } from "./sigilSpace";

// ── Types ──

/** A remembered sigil — a position in ContrastSpace. !geometric-storage */
export interface RememberedSigil {
  name: string;
  vocabulary: Vocabulary;
  edges: CoOccurrence[];
  weight: number;
  lastReinforced: number;
  createdAt: number;
}

/** A short-term trace — one remember event, serializable to JSONL. */
export interface ShortTermTrace {
  name: string;
  vocabulary: Vocabulary;
  edges: CoOccurrence[];
  timestamp: number;
}

/** The full memory state. */
export interface MemoryState {
  /** Long-term: consolidated, persists across sessions. */
  longTerm: Map<string, RememberedSigil>;
  /** Short-term: raw traces from the current session. */
  shortTerm: ShortTermTrace[];
}

/** What recognition returns. */
export interface RecognitionResult {
  remembered: RememberedSigil;
  distance: number;
}

// ── Constants ──

const RECOGNITION_THRESHOLD = 0.1;
const DECAY_FACTOR = 0.8;
const REINFORCEMENT_BOOST = 0.3;
const MAX_WEIGHT = 3.0;
const MERGE_CO_OCCURRENCE_THRESHOLD = 0.8;

// ── Public API ──

/** Create an empty memory. */
export function init(): MemoryState {
  return { longTerm: new Map(), shortTerm: [] };
}

/** Create memory with pre-loaded long-term state (from disk on startup). */
export function initWithLongTerm(longTerm: Map<string, RememberedSigil>): MemoryState {
  return { longTerm, shortTerm: [] };
}

/**
 * #remember-a-sigil — record a short-term trace.
 *
 * Returns [nextMemory, trace] — caller persists the trace to JSONL.
 */
export function remember(
  memory: MemoryState,
  node: SigilNode,
  timestamp: number,
): [MemoryState, ShortTermTrace] {
  const trace: ShortTermTrace = {
    name: node.vocabulary.name,
    vocabulary: { ...node.vocabulary },
    edges: [...node.edges],
    timestamp,
  };

  return [
    { ...memory, shortTerm: [...memory.shortTerm, trace] },
    trace,
  ];
}

/**
 * #recognize-familiar-sigil — find a remembered sigil by name.
 *
 * Searches long-term first, then short-term.
 * !vocabulary-retrieval: returns the full vocabulary.
 */
export function recognize(
  memory: MemoryState,
  name: string,
): RecognitionResult | null {
  // Long-term: direct lookup
  const lt = memory.longTerm.get(name);
  if (lt && lt.weight >= RECOGNITION_THRESHOLD) {
    return { remembered: lt, distance: 0 };
  }

  // Short-term: find most recent trace with this name
  for (let i = memory.shortTerm.length - 1; i >= 0; i--) {
    const trace = memory.shortTerm[i];
    if (trace.name === name) {
      return {
        remembered: {
          name: trace.name,
          vocabulary: trace.vocabulary,
          edges: trace.edges,
          weight: 1.0,
          lastReinforced: trace.timestamp,
          createdAt: trace.timestamp,
        },
        distance: 0,
      };
    }
  }

  return null;
}

/**
 * #recall — involuntary recognition near a focus point.
 *
 * Searches both long-term and short-term. Long-term results rank higher.
 */
export function recall(
  memory: MemoryState,
  currentSpace: SigilSpace,
  focus: string,
): RecognitionResult[] {
  const focusNode = currentSpace.nodes.get(focus);
  if (!focusNode) return [];

  const focusNeighbors = new Set(focusNode.edges.map(e => e.target));
  focusNeighbors.add(focus);

  const results: RecognitionResult[] = [];
  const seen = new Set<string>();

  // Long-term first
  for (const entry of memory.longTerm.values()) {
    if (entry.weight < RECOGNITION_THRESHOLD) continue;
    const entryNames = new Set([entry.name, ...entry.edges.map(e => e.target)]);
    const overlap = [...entryNames].filter(n => focusNeighbors.has(n)).length;
    if (overlap === 0) continue;
    results.push({ remembered: entry, distance: 1 / (overlap + 1) });
    seen.add(entry.name);
  }

  // Short-term: most recent trace per name, skip if already in long-term results
  const stByName = new Map<string, ShortTermTrace>();
  for (const trace of memory.shortTerm) {
    stByName.set(trace.name, trace); // last write wins = most recent
  }
  for (const trace of stByName.values()) {
    if (seen.has(trace.name)) continue;
    const entryNames = new Set([trace.name, ...trace.edges.map(e => e.target)]);
    const overlap = [...entryNames].filter(n => focusNeighbors.has(n)).length;
    if (overlap === 0) continue;
    results.push({
      remembered: {
        name: trace.name,
        vocabulary: trace.vocabulary,
        edges: trace.edges,
        weight: 1.0,
        lastReinforced: trace.timestamp,
        createdAt: trace.timestamp,
      },
      distance: 1 / (overlap + 1),
    });
  }

  results.sort((a, b) => (b.remembered.weight / b.distance) - (a.remembered.weight / a.distance));
  return results;
}

/**
 * #consolidate — what #sleep does to memory.
 *
 * Merges short-term traces into long-term:
 * 1. Each short-term trace reinforces or creates a long-term entry.
 * 2. Decay all long-term entries not touched by short-term.
 * 3. Merge co-occurring entries. !co-occurrence-merge.
 * 4. Prune below threshold. !lossy.
 * 5. Clear short-term.
 *
 * attendedNames: sigils the Subconscious judged relevant (from experience).
 */
export function consolidate(
  memory: MemoryState,
  attendedNames: string[],
  currentSpace: SigilSpace,
  timestamp: number,
): MemoryState {
  const attended = new Set(attendedNames);

  // Collect unique short-term names
  const stNames = new Set<string>();
  for (const trace of memory.shortTerm) {
    stNames.add(trace.name);
  }

  let next = new Map(memory.longTerm);

  // 1. Reinforce all attended names (from short-term traces or experience)
  for (const name of attended) {
    const node = currentSpace.nodes.get(name);
    const existing = next.get(name);
    if (existing) {
      next.set(name, {
        ...existing,
        vocabulary: node ? { ...node.vocabulary } : existing.vocabulary,
        edges: node ? [...node.edges] : existing.edges,
        weight: Math.min(existing.weight + REINFORCEMENT_BOOST, MAX_WEIGHT),
        lastReinforced: timestamp,
      });
    } else if (node) {
      next.set(name, {
        name: node.vocabulary.name,
        vocabulary: { ...node.vocabulary },
        edges: [...node.edges],
        weight: 1.0,
        lastReinforced: timestamp,
        createdAt: timestamp,
      });
    }
  }

  // Also bring in short-term traces not in attended (still worth remembering)
  for (const name of stNames) {
    if (attended.has(name)) continue;
    if (!next.has(name)) {
      const node = currentSpace.nodes.get(name);
      if (node) {
        next.set(name, {
          name: node.vocabulary.name,
          vocabulary: { ...node.vocabulary },
          edges: [...node.edges],
          weight: 1.0,
          lastReinforced: timestamp,
          createdAt: timestamp,
        });
      }
    }
  }

  // 2. Decay everything not reinforced this cycle
  const reinforced = new Set([...stNames, ...attended]);
  for (const [name, entry] of next) {
    if (!reinforced.has(name)) {
      next.set(name, { ...entry, weight: entry.weight * DECAY_FACTOR });
    }
  }

  // 3. Merge co-occurring. !co-occurrence-merge
  next = mergeCoOccurring(next, currentSpace);

  // 4. Prune. !lossy
  for (const [name, entry] of next) {
    if (entry.weight < RECOGNITION_THRESHOLD) next.delete(name);
  }

  // 5. Clear short-term — it's been absorbed
  return { longTerm: next, shortTerm: [] };
}

/**
 * Get all recognizable remembered sigils from both layers.
 */
export function allRemembered(memory: MemoryState): RememberedSigil[] {
  const byName = new Map<string, RememberedSigil>();

  // Long-term
  for (const entry of memory.longTerm.values()) {
    if (entry.weight >= RECOGNITION_THRESHOLD) byName.set(entry.name, entry);
  }

  // Short-term: most recent trace per name, only if not already in long-term
  for (const trace of memory.shortTerm) {
    if (byName.has(trace.name)) continue;
    byName.set(trace.name, {
      name: trace.name,
      vocabulary: trace.vocabulary,
      edges: trace.edges,
      weight: 1.0,
      lastReinforced: trace.timestamp,
      createdAt: trace.timestamp,
    });
  }

  return [...byName.values()].sort((a, b) => b.weight - a.weight);
}

// ── Serialization ──

/** Serialize a short-term trace to a JSONL line. */
export function serializeTrace(trace: ShortTermTrace): string {
  return JSON.stringify({ type: "memory-trace", ...trace });
}

/** Parse a JSONL line back to a ShortTermTrace, or null if not a trace. */
export function parseTrace(line: string): ShortTermTrace | null {
  const parsed = JSON.parse(line);
  if (parsed.type !== "memory-trace") return null;
  return {
    name: parsed.name,
    vocabulary: parsed.vocabulary,
    edges: parsed.edges,
    timestamp: parsed.timestamp,
  };
}

/** Serialize long-term memory as a JSON snapshot. */
export function serializeLongTerm(memory: MemoryState): string {
  const entries = [...memory.longTerm.values()];
  return JSON.stringify(entries);
}

/** Parse a long-term memory snapshot. */
export function parseLongTerm(json: string): Map<string, RememberedSigil> {
  const entries: RememberedSigil[] = JSON.parse(json);
  const map = new Map<string, RememberedSigil>();
  for (const entry of entries) map.set(entry.name, entry);
  return map;
}

// ── Internal ──

function mergeCoOccurring(
  sigils: Map<string, RememberedSigil>,
  currentSpace: SigilSpace,
): Map<string, RememberedSigil> {
  const merged = new Map(sigils);
  const consumed = new Set<string>();

  for (const [nameA, entryA] of sigils) {
    if (consumed.has(nameA)) continue;

    const nodeA = currentSpace.nodes.get(nameA);
    if (!nodeA || nodeA.edges.length === 0) continue;

    const strongest = nodeA.edges.reduce((best, e) =>
      e.count > best.count ? e : best, nodeA.edges[0]);

    const nameB = strongest.target;
    if (consumed.has(nameB) || !sigils.has(nameB)) continue;

    const nodeB = currentSpace.nodes.get(nameB);
    if (!nodeB || nodeB.edges.length === 0) continue;

    const strongestB = nodeB.edges.reduce((best, e) =>
      e.count > best.count ? e : best, nodeB.edges[0]);
    if (strongestB.target !== nameA) continue;

    const totalA = nodeA.edges.reduce((sum, e) => sum + e.count, 0);
    const totalB = nodeB.edges.reduce((sum, e) => sum + e.count, 0);
    const ratioA = strongest.count / totalA;
    const ratioB = strongestB.count / totalB;

    if (ratioA < MERGE_CO_OCCURRENCE_THRESHOLD || ratioB < MERGE_CO_OCCURRENCE_THRESHOLD) continue;

    const entryB = sigils.get(nameB)!;
    const [keeper, absorbed] = entryA.weight >= entryB.weight
      ? [entryA, entryB]
      : [entryB, entryA];

    const mergedVocab: Vocabulary = {
      name: keeper.name,
      affordances: [...new Set([...keeper.vocabulary.affordances, ...absorbed.vocabulary.affordances])],
      invariants: [...new Set([...keeper.vocabulary.invariants, ...absorbed.vocabulary.invariants])],
    };

    const edgeMap = new Map<string, number>();
    for (const e of keeper.edges) {
      if (e.target !== absorbed.name) edgeMap.set(e.target, (edgeMap.get(e.target) ?? 0) + e.count);
    }
    for (const e of absorbed.edges) {
      if (e.target !== keeper.name) edgeMap.set(e.target, (edgeMap.get(e.target) ?? 0) + e.count);
    }
    const mergedEdges: CoOccurrence[] = [...edgeMap.entries()].map(([target, count]) => ({ target, count }));

    merged.set(keeper.name, {
      ...keeper,
      vocabulary: mergedVocab,
      edges: mergedEdges,
      weight: keeper.weight + absorbed.weight * 0.5,
    });
    merged.delete(absorbed.name);
    consumed.add(absorbed.name);
  }

  return merged;
}
