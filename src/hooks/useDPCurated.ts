/**
 * useDPCurated — place the DesignPartner's filtering eye between a raw
 * sensory stream and the User's UI.
 *
 * Spec: DesignPartner receives raw sensory input (misfits, Hearing events,
 * dangling refs); the User should see what the DP surfaces, not what the
 * detector raw-emits. This hook is the mechanism.
 *
 * It reads like strategy-pattern dispatch along a chain of responsibility:
 * for each item in the raw stream, construct a Disturbance, consult the
 * Spellbook, and let the first matching Spell's directive decide what
 * happens. A "suppress" directive drops the item from the curated stream;
 * an unmatched item passes through unchanged.
 *
 * Curation today is Spell-only (deterministic, cheap). If no Spell matches,
 * the item is kept — the default is to show, not hide. Future: a Spell
 * can delegate to LH via a future directive; for now, Spell-first as the
 * user asked.
 */
import { useMemo } from "react";
import { consultSpellbook, type Disturbance, type Spellbook } from "sigil-core";

export function useDPCurated<T extends object>(
  rawList: T[],
  spellbook: Spellbook,
  streamName: string,
): T[] {
  return useMemo(() => {
    return rawList.filter((item) => {
      const disturbance: Disturbance = {
        kind: `curate-${streamName}`,
        payload: item as unknown as Record<string, unknown>,
      };
      const consultation = consultSpellbook(disturbance, spellbook);
      if (!consultation.cast) return true; // No matching Spell — keep by default.
      if (!consultation.result.success) return true; // Failed cast — !failure-escalates, but here we default to keep.
      const directives = consultation.result.directives ?? [];
      // Any "suppress" directive drops the item.
      if (directives.some((d) => d.type === "suppress")) return false;
      return true;
    });
  }, [rawList, spellbook, streamName]);
}
