/**
 * Memory — remembered sigils positioned in ContrastSpace.
 *
 * Spec path: DesignPartner/BicameralMind/Memory
 *
 * A remembered sigil is a position in ContrastSpace with vocabulary
 * attached. The position is defined by co-occurrence edges — a shape
 * that deforms as the living text evolves around it. The RightHemisphere
 * sees the deformation; the LeftHemisphere uses the vocabulary.
 *
 * Four sub-mechanisms:
 *   Recognition — find nearest remembered sigil to a shape, retrieve vocabulary
 *   Consolidation — reinforce attended traces, merge co-occurring remembered sigils
 *   Decay — unreinforced remembered sigils lose weight until recognition fails
 *   Relevance — determines what persists vs what fades
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
  /** The sigil's canonical name. */
  name: string;
  /** Vocabulary attached to this position — what the LH uses. */
  vocabulary: Vocabulary;
  /** Co-occurrence edges at the time of remembering — the position. */
  edges: CoOccurrence[];
  /** Reinforcement weight. Starts at 1.0, grows with consolidation, decays over time. */
  weight: number;
  /** When this was last reinforced (ms since epoch). */
  lastReinforced: number;
  /** When this was first remembered (ms since epoch). */
  createdAt: number;
}

/** The full memory state. Held by the caller, threaded through. */
export interface MemoryState {
  /** All remembered sigils, keyed by name. */
  sigils: Map<string, RememberedSigil>;
}

/** What recognition returns — the remembered sigil and its distance to the query. */
export interface RecognitionResult {
  remembered: RememberedSigil;
  distance: number;
}

// ── Constants ──

/** Below this weight, recognition fails. */
const RECOGNITION_THRESHOLD = 0.1;

/** Multiplicative decay per consolidation cycle. */
const DECAY_FACTOR = 0.8;

/** Additive boost on reinforcement. */
const REINFORCEMENT_BOOST = 0.3;

/** Max weight cap — prevents runaway reinforcement. */
const MAX_WEIGHT = 3.0;

/** Co-occurrence ratio above which two remembered sigils get merged. */
const MERGE_CO_OCCURRENCE_THRESHOLD = 0.8;

// ── Public API ──

/** Create an empty memory. */
export function init(): MemoryState {
  return { sigils: new Map() };
}

/**
 * #remember-a-sigil — place a new position in memory from a live SigilSpace node.
 *
 * If already remembered, reinforces it instead.
 * !geometric-storage: stores position (edges) and vocabulary.
 */
export function remember(
  memory: MemoryState,
  node: SigilNode,
  timestamp: number,
): MemoryState {
  const existing = memory.sigils.get(node.vocabulary.name);
  if (existing) {
    return reinforce(memory, node.vocabulary.name, node, timestamp);
  }

  const entry: RememberedSigil = {
    name: node.vocabulary.name,
    vocabulary: { ...node.vocabulary },
    edges: [...node.edges],
    weight: 1.0,
    lastReinforced: timestamp,
    createdAt: timestamp,
  };

  const next = new Map(memory.sigils);
  next.set(entry.name, entry);
  return { sigils: next };
}

/**
 * #recognize-familiar-sigil — find a remembered sigil by name.
 *
 * !vocabulary-retrieval: returns the full vocabulary, not just the name.
 * Returns null if not found or below weight threshold.
 */
export function recognize(
  memory: MemoryState,
  name: string,
): RecognitionResult | null {
  const entry = memory.sigils.get(name);
  if (!entry) return null;
  if (entry.weight < RECOGNITION_THRESHOLD) return null;
  return { remembered: entry, distance: 0 };
}

/**
 * #recall — involuntary recognition near a focus point.
 *
 * Given the current space and a focus, find all remembered sigils whose
 * positions overlap with the focus neighborhood. Returns them sorted by
 * relevance (weight * closeness).
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

  for (const entry of memory.sigils.values()) {
    if (entry.weight < RECOGNITION_THRESHOLD) continue;

    // Overlap: how many of this remembered sigil's names touch the focus neighborhood?
    const entryNames = new Set([entry.name, ...entry.edges.map(e => e.target)]);
    const overlap = [...entryNames].filter(n => focusNeighbors.has(n)).length;
    if (overlap === 0) continue;

    const distance = 1 / (overlap + 1);
    results.push({ remembered: entry, distance });
  }

  results.sort((a, b) => (b.remembered.weight / b.distance) - (a.remembered.weight / a.distance));
  return results;
}

/**
 * #consolidate — what #sleep does to memory.
 *
 * 1. Reinforce sigils the Subconscious attended to.
 * 2. Decay all others. !passive-decay.
 * 3. Remember new attended sigils not yet in memory.
 * 4. Merge sigils that always co-occur. !co-occurrence-merge.
 * 5. Prune below recognition threshold. !lossy.
 */
export function consolidate(
  memory: MemoryState,
  attendedNames: string[],
  currentSpace: SigilSpace,
  timestamp: number,
): MemoryState {
  const attended = new Set(attendedNames);
  let next = new Map(memory.sigils);

  // 1 + 2. Reinforce attended, decay others
  for (const [name, entry] of next) {
    if (attended.has(name)) {
      const node = currentSpace.nodes.get(name);
      if (node) {
        next.set(name, {
          ...entry,
          vocabulary: { ...node.vocabulary },
          edges: [...node.edges],
          weight: Math.min(entry.weight + REINFORCEMENT_BOOST, MAX_WEIGHT),
          lastReinforced: timestamp,
        });
      } else {
        next.set(name, {
          ...entry,
          weight: Math.min(entry.weight + REINFORCEMENT_BOOST, MAX_WEIGHT),
          lastReinforced: timestamp,
        });
      }
    } else {
      next.set(name, {
        ...entry,
        weight: entry.weight * DECAY_FACTOR,
      });
    }
  }

  // 3. Remember new attended sigils not yet in memory
  for (const name of attended) {
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

  // 4. Merge co-occurring sigils. !co-occurrence-merge
  next = mergeCoOccurring(next, currentSpace);

  // 5. Prune below threshold. !lossy
  for (const [name, entry] of next) {
    if (entry.weight < RECOGNITION_THRESHOLD) {
      next.delete(name);
    }
  }

  return { sigils: next };
}

/**
 * Get all recognizable remembered sigils, sorted by weight descending.
 */
export function allRemembered(memory: MemoryState): RememberedSigil[] {
  return [...memory.sigils.values()]
    .filter(s => s.weight >= RECOGNITION_THRESHOLD)
    .sort((a, b) => b.weight - a.weight);
}

// ── Internal ──

/** Reinforce an existing remembered sigil with fresh position and vocabulary. */
function reinforce(
  memory: MemoryState,
  name: string,
  node: SigilNode,
  timestamp: number,
): MemoryState {
  const entry = memory.sigils.get(name);
  if (!entry) return memory;

  const next = new Map(memory.sigils);
  next.set(name, {
    ...entry,
    vocabulary: { ...node.vocabulary },
    edges: [...node.edges],
    weight: Math.min(entry.weight + REINFORCEMENT_BOOST, MAX_WEIGHT),
    lastReinforced: timestamp,
  });
  return { sigils: next };
}

/**
 * !co-occurrence-merge: remembered sigils that always appear together get merged.
 *
 * Two entries A and B merge when each is the other's strongest co-occurrence
 * edge and that edge accounts for > threshold of their total edge weight.
 * The higher-weighted one absorbs the other's vocabulary.
 */
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
