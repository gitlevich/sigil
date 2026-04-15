/**
 * ExperiencePanel — the time-like view of ContrastSpace, as a right-panel tab.
 *
 * Shows the live stream of experience segments with narrated descriptions
 * of what changed structurally. No more raw numbers — the CorpusCallosum's
 * Narration resolves each disturbance into language.
 */
import { useState, useEffect, useRef } from "react";
import { useExperience } from "../../state/ExperienceContext";
import { useWorkspaceState } from "../../state/WorkspaceContext";
import { api } from "../../tauri";
import { parseSession, entryToSegment } from "sigil-core/experience";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";
import styles from "./ExperiencePanel.module.css";

export function ExperiencePanel() {
  const { getExperience } = useExperience();
  const ws = useWorkspaceState();
  const [pastSegments, setPastSegments] = useState<ExperienceSegment[]>([]);
  const [liveSegments, setLiveSegments] = useState<ExperienceSegment[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  // Load past sessions from disk on first mount — !complete, !causal-ordering
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    api.listExperienceSessions(ws.spec.rootPath).then(contents => {
      const past: ExperienceSegment[] = [];
      for (const content of contents) {
        const session = parseSession(content);
        if (!session) continue;
        for (const entry of session.entries) {
          past.push(entryToSegment(entry) as ExperienceSegment);
        }
      }
      setPastSegments(past);
    }).catch(err => {
      console.error("[Experience] failed to load past sessions:", err);
    });
  }, [ws.spec.rootPath]);

  // Poll live experience
  useEffect(() => {
    setLiveSegments(getExperience());
    const interval = setInterval(() => setLiveSegments(getExperience()), 1000);
    return () => clearInterval(interval);
  }, [getExperience]);

  // Merge: past sessions first, then live (deduplicate by timestamp)
  const liveTimestamps = new Set(liveSegments.map(s => s.timestamp));
  const deduped = pastSegments.filter(s => !liveTimestamps.has(s.timestamp));
  const segments = [...deduped, ...liveSegments];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [segments.length]);

  // Show segments with disturbance, resolution, or chat messages
  const meaningful = segments.filter(s => s.disturbance.total > 0 || s.resolution || s.message);

  return (
    <div className={styles.panel} ref={listRef}>
      {meaningful.length === 0 ? (
        <div className={styles.empty}>No structural changes yet. Edit a sigil.</div>
      ) : (
        meaningful.map((seg, i) => <Entry key={i} segment={seg} />)
      )}
    </div>
  );
}

function Entry({ segment }: { segment: ExperienceSegment }) {
  const time = new Date(segment.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const resolution = segment.resolution;
  const message = segment.message;

  return (
    <div className={`${styles.entry} ${segment.relevant ? styles.relevant : styles.muted} ${message ? styles.chatEntry : ""}`}>
      <div className={styles.entryHeader}>
        <span className={styles.time}>{timeStr}</span>
        {message && <span className={styles.role}>{message.role}</span>}
        {segment.disturbance.total > 0 && (
          <span className={styles.magnitude}>{segment.disturbance.total.toFixed(0)}</span>
        )}
      </div>
      {message ? (
        <div className={styles.chatMessage}>{message.content.slice(0, 200)}{message.content.length > 200 ? "..." : ""}</div>
      ) : resolution ? (
        <div className={styles.narration}>
          {resolution.changes.slice(0, 4).map((c, i) => (
            <div key={i} className={`${styles.change} ${styles[c.kind] ?? ""}`}>
              {c.description}
            </div>
          ))}
          {resolution.changes.length > 4 && (
            <div className={styles.more}>+{resolution.changes.length - 4} more</div>
          )}
        </div>
      ) : (
        <div className={styles.sigils}>
          {segment.sigils.map(name => (
            <span key={name} className={styles.sigilTag}>{name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
