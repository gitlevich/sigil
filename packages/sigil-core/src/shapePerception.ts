/**
 * ShapePerception — what the RightHemisphere sees when it looks at a sigil.
 *
 * The RH sees the sigil tree through co-occurrence entanglement, at every scale.
 * At each node it senses: how tightly are my children woven? How much do they
 * leak outward? Are there names used but never defined? Is the parent's language
 * grounded in its children's vocabulary?
 *
 * These are not 2D coordinates. They are shape properties at each level of the
 * tree — the multi-scale, hierarchical perception the spec describes:
 *   "I see through many scales. The top levels are clear. Deeper levels get
 *    fuzzier. By six or seven levels down, I can't distinguish individual
 *    sigils — just texture."
 *
 * Pure functions over SigilSpace + Sigil tree. No I/O, no LLM.
 */
import type { Sigil } from "./types";
import type { SigilSpace } from "./sigilSpace";

// ── Types ──

/** The shape of a single sigil as perceived by the RightHemisphere. */
export interface LocalShape {
  /** The sigil's name. */
  name: string;
  /** Depth in the tree (root = 0). */
  depth: number;
  /** How many children this sigil has. */
  childCount: number;

  /**
   * Internal entanglement: what fraction of possible child-to-child edges
   * actually exist. 1.0 = every child co-occurs with every other child.
   * 0.0 = children never mention each other. This is the weave density.
   * A well-shaped sigil has children that talk to each other.
   */
  weave: number;

  /**
   * External leakage: what fraction of children's edges point outside
   * this sigil's boundary (not to siblings or self). High leakage means
   * the children are more entangled with distant sigils than with each other.
   * The sigil's boundary is porous — attention escapes.
   */
  leakage: number;

  /**
   * Grounding: does this sigil's own language reference its children?
   * Ratio of children mentioned in the parent's language to total children.
   * A grounded sigil describes itself using its own vocabulary.
   * An ungrounded sigil talks about things its children don't define.
   */
  grounding: number;

  /**
   * Sufficiency gaps: names that appear as @references in this sigil's
   * content but resolve to no sigil in the tree. These are holes —
   * entanglement patterns that imply a sigil should exist but doesn't.
   */
  gaps: string[];

  /**
   * Orphan children: children that have zero co-occurrence edges with
   * any sibling. They exist in the tree but are invisible in the
   * co-occurrence geometry — disconnected from the shape.
   */
  orphans: string[];

  /**
   * Surface area: number of affordances + invariants.
   * The spec says "surface from affordances." More affordances = larger
   * surface. Changes in surface mean the sigil grew or shrank.
   */
  surface: number;

  /**
   * Content volume: total character count of language + affordances + invariants.
   * The spec says "radius from content volume." More content = larger sphere.
   */
  volume: number;
}

/** The full shape perception — the tree seen at every scale. */
export interface ShapeReading {
  /** Shape of every sigil that has children, keyed by name. */
  shapes: Map<string, LocalShape>;
  /** Global: total sufficiency gaps across the whole tree. */
  totalGaps: number;
  /** Global: average weave across all non-leaf sigils. */
  averageWeave: number;
  /** Global: average leakage across all non-leaf sigils. */
  averageLeakage: number;
}

// ── Helpers ──

/** Concatenate all text content of a sigil (language + affordances + invariants). */
function allText(s: Sigil): string {
  return [
    s.language,
    ...s.affordances.map(a => a.content),
    ...s.invariants.map(i => i.content),
  ].join(" ");
}

// ── Core perception ──

/**
 * Perceive the shape of a single sigil — its local geometry.
 */
export function perceiveLocal(
  sigil: Sigil,
  space: SigilSpace,
  depth: number,
): LocalShape {
  const childNames = new Set(sigil.children.filter(c => !c.isImported).map(c => c.name));
  const childCount = childNames.size;

  const surface = sigil.affordances.length + sigil.invariants.length;
  const volume = allText(sigil).length;

  if (childCount === 0) {
    return {
      name: sigil.name,
      depth,
      childCount: 0,
      weave: 1, // a leaf is perfectly woven with itself
      leakage: 0,
      grounding: 1, // a leaf doesn't need to ground children
      gaps: findGaps(sigil, space),
      orphans: [],
      surface,
      volume,
    };
  }

  // Weave: fraction of possible child-child connections that exist.
  // Two children are connected if either references the other anywhere
  // in its text (language, affordances, invariants). This is broader than
  // co-occurrence (which requires two @refs in the same sentence) —
  // a child that says "I serve @Sibling" is connected even if it names
  // no other sibling in that sentence.
  const possibleEdges = childCount * (childCount - 1) / 2;
  let actualEdges = 0;
  const childArray = [...childNames];
  const childSigils = new Map(sigil.children.filter(c => !c.isImported).map(c => [c.name, c]));

  for (let i = 0; i < childArray.length; i++) {
    for (let j = i + 1; j < childArray.length; j++) {
      // Check co-occurrence edges (strong signal)
      const nodeI = space.nodes.get(childArray[i]);
      if (nodeI?.edges.some(e => e.target === childArray[j])) {
        actualEdges++;
        continue;
      }
      // Check direct @reference in text (weaker but real signal)
      const sigilI = childSigils.get(childArray[i]);
      const sigilJ = childSigils.get(childArray[j]);
      const iMentionsJ = sigilI && allText(sigilI).includes(`@${childArray[j]}`);
      const jMentionsI = sigilJ && allText(sigilJ).includes(`@${childArray[i]}`);
      if (iMentionsJ || jMentionsI) {
        actualEdges++;
      }
    }
  }
  const weave = possibleEdges > 0 ? actualEdges / possibleEdges : 1;

  // Leakage: fraction of children's edges that point outside this sigil's boundary
  let internalEdgeCount = 0;
  let totalEdgeCount = 0;
  for (const childName of childNames) {
    const node = space.nodes.get(childName);
    if (!node) continue;
    for (const edge of node.edges) {
      totalEdgeCount++;
      // Internal: edge target is a sibling or the parent itself
      if (childNames.has(edge.target) || edge.target === sigil.name) {
        internalEdgeCount++;
      }
    }
  }
  const leakage = totalEdgeCount > 0 ? 1 - (internalEdgeCount / totalEdgeCount) : 0;

  // Grounding: does the parent's language mention its children?
  const parentNode = space.nodes.get(sigil.name);
  let mentionedChildren = 0;
  if (parentNode) {
    for (const childName of childNames) {
      // Check if the parent's text contains @childName references
      // We use co-occurrence edges as proxy — if parent co-occurs with child,
      // they were mentioned together somewhere
      if (parentNode.edges.some(e => e.target === childName)) {
        mentionedChildren++;
      }
    }
  }
  // Also check if the parent's language directly mentions children by name
  // (even without co-occurrence — single @ref in a sentence counts)
  if (sigil.language) {
    for (const childName of childNames) {
      if (sigil.language.includes(`@${childName}`) && mentionedChildren < childCount) {
        // Only count if not already counted via co-occurrence
        const alreadyCounted = parentNode?.edges.some(e => e.target === childName) ?? false;
        if (!alreadyCounted) mentionedChildren++;
      }
    }
  }
  const grounding = childCount > 0 ? mentionedChildren / childCount : 1;

  // Orphans: children with no connection to any sibling —
  // neither co-occurrence edges nor direct @references.
  const orphans: string[] = [];
  for (const childName of childNames) {
    const node = space.nodes.get(childName);
    const hasSiblingEdge = node?.edges.some(e => childNames.has(e.target)) ?? false;
    if (hasSiblingEdge) continue;

    // Check direct text references
    const childSigil = childSigils.get(childName);
    const otherChildren = [...childNames].filter(n => n !== childName);
    const mentionsSibling = childSigil && otherChildren.some(
      sib => allText(childSigil).includes(`@${sib}`),
    );
    const mentionedBySibling = otherChildren.some(sib => {
      const sibSigil = childSigils.get(sib);
      return sibSigil && allText(sibSigil).includes(`@${childName}`);
    });
    if (!mentionsSibling && !mentionedBySibling) {
      orphans.push(childName);
    }
  }

  return {
    name: sigil.name,
    depth,
    childCount,
    weave,
    leakage,
    grounding,
    gaps: findGaps(sigil, space),
    orphans,
    surface,
    volume,
  };
}

/**
 * Find sufficiency gaps — @references that don't resolve to any sigil in the space.
 */
function findGaps(sigil: Sigil, space: SigilSpace): string[] {
  const gaps: string[] = [];
  const refPattern = /@([A-Z][a-zA-Z]*)/g;
  const text = allText(sigil);

  let match;
  const seen = new Set<string>();
  while ((match = refPattern.exec(text)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!space.nodes.has(name)) {
      gaps.push(name);
    }
  }
  return gaps;
}

// ── Full tree perception ──

/**
 * Perceive the shape of the entire tree — the RH seeing at every scale.
 *
 * Walks the tree top-down, computing local shape at each non-leaf sigil.
 * Returns a reading the CorpusCallosum can compress into language.
 */
export function perceiveShape(
  root: Sigil,
  space: SigilSpace,
): ShapeReading {
  const shapes = new Map<string, LocalShape>();

  function walk(sigil: Sigil, depth: number): void {
    const shape = perceiveLocal(sigil, space, depth);
    shapes.set(sigil.name, shape);
    for (const child of sigil.children) {
      if (child.isImported) continue;
      walk(child, depth + 1);
    }
  }

  walk(root, 0);

  // Global aggregates
  let totalGaps = 0;
  let weaveSum = 0;
  let leakageSum = 0;
  let nonLeafCount = 0;

  for (const shape of shapes.values()) {
    totalGaps += shape.gaps.length;
    if (shape.childCount > 0) {
      weaveSum += shape.weave;
      leakageSum += shape.leakage;
      nonLeafCount++;
    }
  }

  return {
    shapes,
    totalGaps,
    averageWeave: nonLeafCount > 0 ? weaveSum / nonLeafCount : 1,
    averageLeakage: nonLeafCount > 0 ? leakageSum / nonLeafCount : 0,
  };
}

// ── Differential perception: what changed ──

/** What changed in a sigil's shape between two readings. */
export interface ShapeShift {
  name: string;
  /** Which properties changed and by how much. */
  weaveChange: number;
  leakageChange: number;
  groundingChange: number;
  /** Change in surface area (affordances + invariants count). */
  surfaceChange: number;
  /** Change in content volume (character count). */
  volumeChange: number;
  /** New gaps that appeared. */
  newGaps: string[];
  /** Gaps that were filled. */
  filledGaps: string[];
  /** Children that became orphaned. */
  newOrphans: string[];
  /** Children that gained sibling connections. */
  connectedOrphans: string[];
}

/**
 * Compare two shape readings — what the RH perceives as change.
 *
 * Returns only sigils whose shape actually shifted. The RH doesn't
 * attend to what stayed the same.
 */
export function diffShape(
  oldReading: ShapeReading,
  newReading: ShapeReading,
): ShapeShift[] {
  const shifts: ShapeShift[] = [];

  for (const [name, newShape] of newReading.shapes) {
    const oldShape = oldReading.shapes.get(name);
    if (!oldShape) continue; // new sigil — handled separately

    const weaveChange = newShape.weave - oldShape.weave;
    const leakageChange = newShape.leakage - oldShape.leakage;
    const groundingChange = newShape.grounding - oldShape.grounding;
    const surfaceChange = newShape.surface - oldShape.surface;
    const volumeChange = newShape.volume - oldShape.volume;

    const oldGapSet = new Set(oldShape.gaps);
    const newGapSet = new Set(newShape.gaps);
    const newGaps = newShape.gaps.filter(g => !oldGapSet.has(g));
    const filledGaps = oldShape.gaps.filter(g => !newGapSet.has(g));

    const oldOrphanSet = new Set(oldShape.orphans);
    const newOrphanSet = new Set(newShape.orphans);
    const newOrphans = newShape.orphans.filter(o => !oldOrphanSet.has(o));
    const connectedOrphans = oldShape.orphans.filter(o => !newOrphanSet.has(o));

    const changed = Math.abs(weaveChange) > 0.001
      || Math.abs(leakageChange) > 0.001
      || Math.abs(groundingChange) > 0.001
      || surfaceChange !== 0
      || volumeChange !== 0
      || newGaps.length > 0
      || filledGaps.length > 0
      || newOrphans.length > 0
      || connectedOrphans.length > 0;

    if (changed) {
      shifts.push({
        name,
        weaveChange,
        leakageChange,
        groundingChange,
        surfaceChange,
        volumeChange,
        newGaps,
        filledGaps,
        newOrphans,
        connectedOrphans,
      });
    }
  }

  return shifts;
}
