/**
 * Attention — the DP's own attention stream.
 *
 * Spec path: DesignPartner/Attention
 *
 * The DP's attention is his own, distinct from the user's. It is anchored by
 * the user's focus but not bound to it — @Attraction can pull him elsewhere.
 * Where his attention rests is what he currently attends to; the sequence of
 * past focuses forms a @Path that enters @Memory during #sleep.
 *
 * Pure functions. No I/O. Caller persists state across sessions.
 */

/** A single moment of attention: what he's attending to and when it began. */
export interface Focus {
  sigilName: string;
  since: number;
}

/** His attention as a stream — current focus plus the trajectory of past focuses. */
export interface AttentionState {
  /** What he is attending to now. Null at startup before any focus is set. */
  current: Focus | null;
  /** Past focuses, oldest → newest, not including current. Capped at TRAJECTORY_CAP. */
  trajectory: Focus[];
}

const TRAJECTORY_CAP = 32;

/** Empty attention state. */
export function init(): AttentionState {
  return { current: null, trajectory: [] };
}

/**
 * Shift focus to a sigil.
 *
 * If already focused on the same sigil, this is a no-op — he keeps attending.
 * If focused on a different sigil (or nothing), the previous focus enters the
 * trajectory and a new focus begins.
 */
export function shift(state: AttentionState, sigilName: string, now: number): AttentionState {
  if (state.current && state.current.sigilName === sigilName) {
    return state;
  }
  const trajectory = state.current
    ? [...state.trajectory, state.current].slice(-TRAJECTORY_CAP)
    : state.trajectory;
  return {
    current: { sigilName, since: now },
    trajectory,
  };
}

/**
 * Anchor his attention to the user's focus.
 *
 * Baseline behavior: ride with the user. Attraction-driven shifts can occur
 * before this is called on a given tick, overriding the anchor. This is how
 * anchored-but-not-bound gets implemented: pulls compete with the anchor, and
 * whichever fires last wins for the tick.
 */
export function anchorTo(state: AttentionState, userSigilName: string, now: number): AttentionState {
  return shift(state, userSigilName, now);
}

/** The sigil he is currently attending to, or null if no focus is set. */
export function currentFocus(state: AttentionState): string | null {
  return state.current ? state.current.sigilName : null;
}

/** The sequence of sigils he has attended to, oldest → newest, including current. */
export function walkedPath(state: AttentionState): string[] {
  const past = state.trajectory.map((f) => f.sigilName);
  return state.current ? [...past, state.current.sigilName] : past;
}
