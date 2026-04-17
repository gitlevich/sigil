/**
 * Temporal compression — filter the stream of Hearing events by pull, so
 * each frame-tick carries only what is worth the local model's attention.
 *
 * Spec path: infrastructure for DesignPartner/Attention; not a sigil.
 *
 * Image compression along the spatial axis drops perceptually-irrelevant
 * detail. Temporal compression along time drops attention-irrelevant
 * change. Both axes collapse along @Relevance.
 *
 * Heuristic v1 — no semantic judge, just rules:
 *   structural events (new/deleted/renamed/moved sigil) always pass
 *   affordance and invariant events pass (schema-level changes)
 *   language events pass when they carry structural implication
 *     (dangling ref, resolved ref) but not bare content edits
 *
 * The local model eventually takes over this filter, deciding what pulls
 * by reading the spatial compression + the raw event. Until then these
 * rules keep frames coherent.
 *
 * Pure functions.
 */

/** Minimal shape the filter needs. */
export interface TemporalEvent {
  timestamp: number;
  kind: "language" | "affordance" | "invariant" | "structural";
  summary: string;
}

/** Keep only events at or after `since`. `null` means keep all. */
export function sinceLast<T extends { timestamp: number }>(
  events: T[],
  since: number | null,
): T[] {
  if (since === null) return events;
  return events.filter((e) => e.timestamp > since);
}

/**
 * Filter events by @Relevance — keep what pulls, drop what doesn't.
 *
 * Structural, affordance, invariant kinds always carry pull.
 * Language kind passes only when its summary signals a structural
 * implication (a reference changed state).
 */
export function filterByPull<T extends TemporalEvent>(events: T[]): T[] {
  return events.filter(hasPull);
}

function hasPull(event: TemporalEvent): boolean {
  if (event.kind !== "language") return true;
  // Language events with structural-implication signals in their summary pass.
  const s = event.summary.toLowerCase();
  return (
    s.includes("unresolved")
    || s.includes("resolved")
    || s.includes("dangling")
    || s.includes("references")
    || s.includes("renamed")
    || s.includes("moved")
  );
}
