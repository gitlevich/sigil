import { useMemo } from "react";
import { detectNameMisfits, type NameMisfit, type Sigil } from "sigil-core";

export type { NameMisfit };

/**
 * Probe the RightHemisphere's #senses-name-misfit faculty against the current
 * tree. Returns a list of resolved @references that look out of place — names
 * that land on real sigils but sit in the wrong neighborhood for their line.
 *
 * Memoized on tree identity — only re-runs when the spec changes.
 */
export function useNameMisfits(
  root: Sigil | null,
  importedOntologies?: Sigil | null,
): NameMisfit[] {
  return useMemo(() => {
    if (!root) return [];
    let checkRoot = root;
    if (importedOntologies) {
      const libs: Sigil = { ...importedOntologies, isImported: true };
      checkRoot = { ...root, children: [...root.children, libs] };
    }
    return detectNameMisfits(checkRoot, importedOntologies ?? null);
  }, [root, importedOntologies]);
}
