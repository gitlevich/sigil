/**
 * sigilSpaceLayout — position sigils as nested spheres in 3D.
 *
 * Each sigil becomes a sphere. Parent spheres contain child spheres.
 * Children are distributed on the interior surface of their parent
 * using a golden-angle spiral (Fibonacci sphere). Co-occurrence edges
 * pull entangled sigils closer together as a post-pass spring adjustment.
 */
import type { Sigil, SigilSpace } from "sigil-core";
import { allRefsPattern, isInCodeSpan } from "sigil-core";

export interface SphereNode {
  name: string;
  path: string[];
  position: [number, number, number];
  radius: number;
  children: SphereNode[];
  entanglements: { target: string; strength: number; sharedAffordances: string[] }[];
  depth: number;
  affordanceNames: string[];
  invariantNames: string[];
  /** The narrative language of this sigil, stripped of frontmatter. */
  language: string;
}

/** Strip YAML frontmatter and heading from language text. */
function stripLanguageFrontmatter(text: string): string {
  let s = text;
  if (s.startsWith("---")) {
    const end = s.indexOf("\n---", 3);
    if (end !== -1) s = s.slice(end + 4);
  }
  // Strip leading heading line
  s = s.replace(/^\s*#[^\n]*\n/, "");
  return s.trim();
}

/**
 * Find affordance names that connect two sigils.
 * Looks for #affordance references in language text where @otherSigil also appears
 * in the same sentence, plus any affordance names shared between both sigils.
 */
/**
 * Find affordance names that connect two sigils.
 * Scans the parent's language (and both sigils' language) for sentences
 * where both @names appear, collecting any #affordance refs from those sentences.
 */
function findSharedAffordances(sigilName: string, otherName: string, parent: Sigil): string[] {
  const result = new Set<string>();

  // Scan all text sources: parent language, parent affordances, both sigils' language
  const texts: string[] = [];
  texts.push(parent.language || "");
  for (const a of parent.affordances) texts.push(a.content || "");
  const selfChild = parent.children.find(c => c.name === sigilName);
  const otherChild = parent.children.find(c => c.name === otherName);
  if (selfChild) texts.push(selfChild.language || "");
  if (otherChild) texts.push(otherChild.language || "");

  const nameA = sigilName.toLowerCase();
  const nameB = otherName.toLowerCase();

  for (const text of texts) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      let mentionsA = false;
      let mentionsB = false;
      const affordances: string[] = [];
      allRefsPattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = allRefsPattern.exec(sentence)) !== null) {
        if (isInCodeSpan(sentence, m.index)) continue;
        const token = m[0];
        if (token.startsWith("@")) {
          const name = token.slice(1).toLowerCase().replace(/@.*$/, "");
          if (name === nameA) mentionsA = true;
          if (name === nameB) mentionsB = true;
        }
        if (token.startsWith("#")) {
          affordances.push(token.slice(1));
        }
      }
      if (mentionsA && mentionsB) {
        for (const a of affordances) result.add(a);
      }
    }
  }

  return [...result];
}

/** Golden angle in radians — irrational spacing that avoids clustering. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Count all descendants (including self). */
function subtreeSize(sigil: Sigil): number {
  let count = 1;
  for (const child of sigil.children) {
    if (child.isImported) continue;
    count += subtreeSize(child);
  }
  return count;
}

/**
 * Distribute N points on a sphere surface using the Fibonacci spiral.
 * Returns unit-sphere positions scaled by `radius` and offset by `center`.
 */
function fibonacciSphere(
  n: number,
  radius: number,
  center: [number, number, number],
): [number, number, number][] {
  if (n === 0) return [];
  if (n === 1) return [center];
  const points: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i) / (n - 1);
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push([
      center[0] + x * radius,
      center[1] + y * radius,
      center[2] + z * radius,
    ]);
  }
  return points;
}

/**
 * Build a SphereNode tree from a Sigil tree.
 *
 * `parentRadius` is the containing sphere's radius.
 * Children are placed at 60% of parent radius (leaving room for the shell).
 * Each child's radius is proportional to its subtree weight.
 */
function layoutSigil(
  sigil: Sigil,
  path: string[],
  center: [number, number, number],
  parentRadius: number,
  depth: number,
  space: SigilSpace | null,
  parentSigil: Sigil | null,
): SphereNode {
  const nonImportedChildren = sigil.children.filter(c => !c.isImported);
  const totalWeight = nonImportedChildren.reduce((sum, c) => sum + subtreeSize(c), 0);

  const radius = parentRadius;

  // Dense space — children close to parent scale, breathing but not lost
  const n = nonImportedChildren.length;
  const placementRadius = radius * 0.45;
  const positions = fibonacciSphere(n, placementRadius, center);

  // Children are large relative to parent — gentle scale compression
  const minChildRadius = radius * 0.2;
  const maxChildRadius = radius * 0.55;

  const children: SphereNode[] = nonImportedChildren.map((child, i) => {
    const weight = subtreeSize(child);
    const fraction = totalWeight > 0 ? weight / totalWeight : 1 / Math.max(n, 1);
    const childRadius = Math.max(minChildRadius, Math.min(maxChildRadius, radius * 0.4 * Math.sqrt(fraction)));
    const childPath = [...path, child.name];
    return layoutSigil(child, childPath, positions[i], childRadius, depth + 1, space, sigil);
  });

  // Gather entanglements from the co-occurrence graph
  const entanglements: { target: string; strength: number; sharedAffordances: string[] }[] = [];
  if (space) {
    const node = space.nodes.get(sigil.name);
    if (node) {
      for (const edge of node.edges) {
        const shared = parentSigil
          ? findSharedAffordances(sigil.name, edge.target, parentSigil)
          : [];
        entanglements.push({ target: edge.target, strength: edge.count, sharedAffordances: shared });
      }
    }
  }

  return {
    name: sigil.name,
    path,
    position: center,
    radius,
    children,
    entanglements,
    depth,
    affordanceNames: sigil.affordances.map(a => a.name),
    invariantNames: sigil.invariants.map(i => i.name),
    language: stripLanguageFrontmatter(sigil.language || ""),
  };
}

/**
 * Build the full layout from a sigil tree and optional co-occurrence space.
 * Returns the root SphereNode with all descendants positioned.
 */
export function buildLayout(
  root: Sigil,
  space: SigilSpace | null,
  rootRadius = 2,
): SphereNode {
  return layoutSigil(root, [], [0, 0, 0], rootRadius, 0, space, null);
}

/**
 * Flatten a SphereNode tree into an array for rendering.
 */
export function flattenSpheres(node: SphereNode): SphereNode[] {
  const result: SphereNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenSpheres(child));
  }
  return result;
}

/**
 * Collect all entanglement edges as pairs of positions for line rendering.
 * Only includes edges where both endpoints exist in the tree.
 */
export function collectEntanglementLines(
  root: SphereNode,
): { from: [number, number, number]; to: [number, number, number]; strength: number }[] {
  const allNodes = flattenSpheres(root);
  const nodeMap = new Map<string, SphereNode>();
  for (const n of allNodes) nodeMap.set(n.name, n);

  const seen = new Set<string>();
  const lines: { from: [number, number, number]; to: [number, number, number]; strength: number }[] = [];

  for (const node of allNodes) {
    for (const ent of node.entanglements) {
      const key = [node.name, ent.target].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const target = nodeMap.get(ent.target);
      if (target) {
        lines.push({ from: node.position, to: target.position, strength: ent.strength });
      }
    }
  }

  return lines;
}
