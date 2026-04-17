/**
 * Subconscious — the RightHemisphere's autopilot.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere/Subconscious
 *
 * Two jobs the spec names. First: when a familiar @sigil — a situation —
 * shows up in what Sight is watching, the Subconscious consults the
 * @Spellbook and casts the matching @Spell. This runs on routine without
 * waking the @LeftHemisphere. If no @Spell matches, the Subconscious
 * lifts through the @CorpusCallosum and the @LeftHemisphere is invoked.
 *
 * Second: the Subconscious is the RightHemisphere's @Relevance filter
 * applied to @Experience (for memory consolidation). That second job
 * lives in rightHemisphere.ts already. This module holds the first.
 *
 * Spec invariants honored here:
 *  !deterministic — Spells run without intelligence. Pattern match,
 *    then invoke.
 *  !failure-escalates — a failed Spell means the world shifted in a
 *    way the Spellbook didn't account for; we lift instead.
 *  !spellbook-complete — the Spellbook is the sole authority on what
 *    the Subconscious can handle alone. No exceptions baked in here.
 */

/** A named, structured event the Subconscious receives. Situations ARE sigils. */
export interface Disturbance {
  /** Short kind name — "name-misfit", "dangling-ref", "hearing-event", etc. */
  kind: string;
  /** Path from root to the sigil where the disturbance originates, if any. */
  path?: string[];
  /** Arbitrary structured detail for the Spell's matcher to read. */
  payload: unknown;
}

/** The result of a cast Spell — either handled (success) or failed. */
export interface SpellResult {
  success: boolean;
  /** If success: a short summary of what the Spell did. If failure: why. */
  summary?: string;
}

/**
 * A Spell is a situation-bound response. The matcher recognizes a
 * Disturbance as belonging to the situation this Spell handles; the cast
 * runs the prescribed response. Deterministic, contract-defined.
 *
 * Spec: DesignPartner/Spellbook/Spell
 */
export interface Spell {
  /** Human-readable name, e.g. "flag-repeated-typo". */
  name: string;
  /** Short prose describing the situation this Spell handles. */
  situation: string;
  /** True if this Disturbance is the situation this Spell is written for. */
  matches: (disturbance: Disturbance) => boolean;
  /** Run the prescribed response. Should not throw; return failure instead. */
  cast: (disturbance: Disturbance) => SpellResult;
}

/**
 * The Spellbook is an ordered collection of Spells. Order matters only for
 * tie-breaking — the first matcher that returns true wins, so specific
 * Spells should come before general ones.
 *
 * Spec: DesignPartner/Spellbook
 */
export interface Spellbook {
  spells: Spell[];
}

/** The outcome of consulting the Spellbook for a Disturbance. */
export type Consultation =
  | { cast: true; spell: string; result: SpellResult }
  | { cast: false; reason: "no-match" | "all-failed" };

/**
 * Consult the Spellbook for a given Disturbance.
 *
 * If a Spell matches and casts successfully, return { cast: true, ... }.
 * If a Spell matches but its cast fails, honor !failure-escalates: do not
 *   try another Spell — lift instead (return { cast: false, reason }).
 * If no Spell matches at all, lift.
 *
 * Lifting means the caller should wake the @LeftHemisphere. This function
 * does not do that; it only reports whether the Subconscious handled it.
 */
export function consultSpellbook(
  disturbance: Disturbance,
  spellbook: Spellbook,
): Consultation {
  for (const spell of spellbook.spells) {
    if (!spell.matches(disturbance)) continue;
    const result = spell.cast(disturbance);
    if (result.success) {
      return { cast: true, spell: spell.name, result };
    }
    return { cast: false, reason: "all-failed" };
  }
  return { cast: false, reason: "no-match" };
}

/** An empty Spellbook. The Subconscious cannot handle anything on its own yet;
 * every Disturbance lifts to the @LeftHemisphere. As Spells are written, they
 * are added here, and the @LeftHemisphere is woken less. */
export const emptySpellbook: Spellbook = { spells: [] };
