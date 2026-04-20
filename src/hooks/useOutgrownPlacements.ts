import { useMemo } from "react";
import { detectOutgrownPlacements, type OutgrownPlacement, type Sigil } from "sigil-core";

export type { OutgrownPlacement };

/**
 * Probe the DesignPartner's #sense-outgrown-placement faculty against the
 * current tree. Returns every sigil whose attendants pull it shallower than
 * its current parent — sigils that were autocreated locally but are now lived
 * as neighbors by many points of view.
 *
 * Spec path: bicameron.sigil/affordance-sense-outgrown-placement
 *
 * Memoized on tree identity — only re-runs when the spec changes.
 */
export function useOutgrownPlacements(
  root: Sigil | null,
  importedOntologies?: Sigil | null,
): OutgrownPlacement[] {
  return useMemo(() => {
    if (!root) return [];
    return detectOutgrownPlacements(root, importedOntologies ?? null);
  }, [root, importedOntologies]);
}
