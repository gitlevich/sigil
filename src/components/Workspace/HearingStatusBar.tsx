/**
 * HearingStatusBar — the User's ambient face on @Hearing.
 *
 * Spec: the apartment reports events happening anywhere in the tree,
 * located by sigil and kind. This bar shows the most recent events —
 * clicking one navigates to the room where it happened. The list
 * collapses rapid repeats (typing bursts) so it stays readable.
 */
import { useState } from "react";
import type { HearingEvent } from "../../hooks/useHearing";
import styles from "./HearingStatusBar.module.css";

interface HearingStatusBarProps {
  events: HearingEvent[];
  onNavigateToEvent?: (event: HearingEvent) => void;
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

const KIND_SYMBOL: Record<HearingEvent["kind"], string> = {
  language: "L",
  affordance: "#",
  invariant: "!",
  structural: "@",
};

export function HearingStatusBar({ events, onNavigateToEvent }: HearingStatusBarProps) {
  const [expanded, setExpanded] = useState(false);
  const hasEvents = events.length > 0;
  const now = Date.now();
  const mostRecent = events[0];

  // Silence as default. An idle hearing is not information — show the bar
  // only when there is something heard. Prevents "everything is the same as
  // it was" noise in the @user's ambient field.
  if (!hasEvents) return null;

  return (
    <div className={styles.container}>
      <div
        className={`${styles.bar} ${styles.barHearing}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.indicator}>
          <span className={styles.dot} />
          Protector heard: {mostRecent.summary} <span className={styles.ts}>({formatRelative(mostRecent.timestamp, now)})</span>
        </span>
      </div>

      {expanded && (
        <div className={styles.panel}>
          {events.map((e) => (
            <div
              key={e.id}
              className={styles.eventLine}
              onClick={(ev) => { ev.stopPropagation(); onNavigateToEvent?.(e); }}
            >
              <span className={`${styles.kind} ${styles[`kind_${e.kind}`]}`}>{KIND_SYMBOL[e.kind]}</span>
              <span className={styles.summary}>{e.summary}</span>
              <span className={styles.ts}>{formatRelative(e.timestamp, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
