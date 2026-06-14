export interface Affordance {
  name: string;
  content: string;
}

export interface Invariant {
  name: string;
  content: string;
}

/**
 * A Sigil — the recursive unit of specification.
 * Has a name, narrative language, affordances, invariants, and child sigils.
 */
export interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  isImported?: boolean;
  /** The vision document (vision.md): a standalone document parallel to the
   * taxonomy, present only at the root. */
  vision?: string;
}

// ── Backward compatibility aliases (deprecated, remove after migration) ──

/** @deprecated Use Sigil instead */
export type Context = Sigil;
