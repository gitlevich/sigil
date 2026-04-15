/**
 * ExperiencePanel — the time-like view, grouped by session.
 *
 * Shows the full causal record: past sessions loaded from disk,
 * live session from the in-memory hemisphere. Each session is visually
 * separated with a header showing when it started.
 */
import { useState, useEffect, useRef } from "react";
import { useExperience } from "../../state/ExperienceContext";
import { useWorkspaceState } from "../../state/WorkspaceContext";
import { api } from "../../tauri";
import { parseSession, entryToSegment } from "sigil-core/experience";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";
import styles from "./ExperiencePanel.module.css";

interface SessionGroup {
  label: string;
  startedAt: number;
  segments: ExperienceSegment[];
}

export function ExperiencePanel() {
  const { getExperience } = useExperience();
  const ws = useWorkspaceState();
  const [pastSessions, setPastSessions] = useState<SessionGroup[]>([]);
  const [liveSegments, setLiveSegments] = useState<ExperienceSegment[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    api.listExperienceSessions(ws.spec.rootPath).then(contents => {
      const groups: SessionGroup[] = [];
      for (const content of contents) {
        const session = parseSession(content);
        if (!session || session.entries.length === 0) continue;
        groups.push({
          label: formatSessionTime(session.header.startedAt),
          startedAt: session.header.startedAt,
          segments: session.entries.map(e => entryToSegment(e) as ExperienceSegment),
        });
      }
      setPastSessions(groups);
    }).catch(err => {
      console.error("[Experience] failed to load past sessions:", err);
    });
  }, [ws.spec.rootPath]);

  useEffect(() => {
    setLiveSegments(getExperience());
    const interval = setInterval(() => setLiveSegments(getExperience()), 1000);
    return () => clearInterval(interval);
  }, [getExperience]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [liveSegments.length]);

  // Filter past sessions to exclude the current live session (by timestamp overlap)
  const liveTimestamps = new Set(liveSegments.map(s => s.timestamp));
  const filteredPast = pastSessions.filter(g =>
    !g.segments.some(s => liveTimestamps.has(s.timestamp))
  );

  const liveMeaningful = liveSegments.filter(s => s.disturbance.total > 0 || s.resolution || s.message);
  const isEmpty = filteredPast.length === 0 && liveMeaningful.length === 0;

  return (
    <div className={styles.panel} ref={listRef}>
      {isEmpty ? (
        <div className={styles.empty}>No experience yet. Edit a sigil or start a conversation.</div>
      ) : (
        <>
          {filteredPast.map((group, gi) => {
            const meaningful = group.segments.filter(s => s.disturbance.total > 0 || s.resolution || s.message);
            if (meaningful.length === 0) return null;
            return (
              <div key={gi}>
                <div className={styles.sessionHeader}>{group.label}</div>
                {meaningful.map((seg, i) => <Entry key={i} segment={seg} />)}
              </div>
            );
          })}
          {liveMeaningful.length > 0 && (
            <div>
              <div className={styles.sessionHeader}>Now</div>
              {liveMeaningful.map((seg, i) => <Entry key={i} segment={seg} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatSessionTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
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
          {segment.disturbance.displaced.length > 0
            ? segment.disturbance.displaced.map(d => (
                <span key={d.name} className={styles.sigilTag}>{d.name} ({d.magnitude})</span>
              ))
            : segment.sigils.map(name => (
                <span key={name} className={styles.sigilTag}>{name}</span>
              ))
          }
        </div>
      )}
    </div>
  );
}
