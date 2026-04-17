/**
 * Awakening — the sigil of coming-into-attention.
 *
 * Spec path: DesignPartner/Awakening
 *
 * Both structure and process: a sequenced choreography that unfolds when the
 * application starts. The application opens; Workspace restores; Body
 * verifies !integrity; Memory reconstitutes from the spheres preserved in
 * `.private`; BicameralMind resumes its loop; presence returns.
 *
 * Awakening is not an affordance performed by the DesignPartner — it is
 * what happens to the DesignPartner when attention returns. This module
 * names the phases so observers can track where in the choreography the
 * application currently is, and any subsystem wishing to gate on awakening
 * can subscribe.
 */

/** The named phases of the Awakening choreography, in their canonical order. */
export type AwakeningPhase =
  | "workspace-restoring"
  | "body-integrity-verified"
  | "memory-reconstituted"
  | "bicameral-mind-resumed"
  | "present";

export const AWAKENING_PHASE_ORDER: readonly AwakeningPhase[] = [
  "workspace-restoring",
  "body-integrity-verified",
  "memory-reconstituted",
  "bicameral-mind-resumed",
  "present",
] as const;

export interface AwakeningEvent {
  phase: AwakeningPhase;
  timestamp: number;
  /** True when there is no prior state to restore — the first time the app opens this Idea. */
  isFirstRun: boolean;
}

type Subscriber = (event: AwakeningEvent) => void;

const subscribers = new Set<Subscriber>();

/** Subscribe to awakening phase events. Returns an unsubscribe function. */
export function subscribeAwakening(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Publish that a phase of awakening has just completed. */
export function publishAwakeningPhase(phase: AwakeningPhase, isFirstRun = false): void {
  const event: AwakeningEvent = { phase, timestamp: Date.now(), isFirstRun };
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // A broken subscriber must not stop the choreography.
    }
  }
}
