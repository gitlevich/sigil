/**
 * EmergenceAnchor — the DesignPartner's #sense-emergence-through-parent.
 *
 * Spec path: bicameron.sigil/affordance-sense-emergence-through-parent
 *
 * Some sigils only mean themselves in the company of their current siblings.
 * @Narrative lives among @Spacelike, @Timelike, @Coherent — they are the
 * neighborhood through which @Narrative gets its flavor. Lifted above them,
 * the neighborhood shatters: its former peers become grandchildren of its
 * former parent while it sits among strangers a level up.
 *
 * This faculty reads the embedding (SigilSpace) and asks one question:
 *   how much co-occurrence mass does the sigil share with its current
 *   direct siblings?
 *
 * If that mass is substantial, a sibling neighborhood exists, and the rise
 * is vetoed — the sigil is emergence-anchored to the place its meaning
 * unfolds with its peers.
 */
import type { Sigil } from "./types";
import type { SigilSpace } from "./sigilSpace";
import { findContext } from "./tree";

export interface EmergenceAnchorOptions {
  /**
   * Minimum co-occurrence mass to the sigil's direct siblings required to
   * veto a rise. Above this, a real sibling neighborhood exists and the
   * sigil belongs with it. Default: 3.
   */
  minSiblingMass?: number;
}

const DEFAULT_MIN_SIBLING_MASS = 3;

/**
 * Does this sigil live in a sibling neighborhood that the rise would shatter?
 *
 * Returns true when the sigil's co-occurrence mass with its current direct
 * siblings reaches the threshold — the siblings are companions, not strangers,
 * and rising above them would strand the sigil from the place its meaning
 * unfolds.
 */
export function isEmergenceAnchored(
  space: SigilSpace,
  root: Sigil,
  selfPath: string[],
  _optimalParent: string[],
  options?: EmergenceAnchorOptions,
): boolean {
  if (selfPath.length === 0) return false;
  const sigilName = selfPath[selfPath.length - 1];
  const node = space.nodes.get(sigilName);
  if (!node) return false; // No embedding evidence → cannot veto.

  const minSiblingMass = options?.minSiblingMass ?? DEFAULT_MIN_SIBLING_MASS;

  const parentPath = selfPath.slice(0, -1);
  const parentSigil = findContext(root, parentPath);
  const siblingNames = new Set<string>();
  for (const c of parentSigil.children) {
    if (c.name === sigilName) continue;
    siblingNames.add(c.name);
  }
  if (siblingNames.size === 0) return false;

  let siblingMass = 0;
  for (const edge of node.edges) {
    if (siblingNames.has(edge.target)) siblingMass += edge.count;
  }

  return siblingMass >= minSiblingMass;
}
