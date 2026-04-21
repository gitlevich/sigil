/**
 * ExperiencePanel — the time-like view, grouped by session.
 *
 * Shows the full causal record: past sessions loaded from disk,
 * live session from the in-memory hemisphere. Each session is visually
 * separated with a header showing when it started.
 *
 * Entries are collapsible. The panel offers collapse-all / expand-all; an
 * entry's header shows a disclosure triangle when there is body to hide.
 * The "+N more" affordance inside a resolution is also expandable — and
 * its expansion state is tracked separately from entry collapse so that
 * expand-all does NOT auto-reveal previously-hidden "+N more" bodies.
 */
import { useState, useEffect, useRef, useMemo } from "react";
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

/** An entry earns a place in the stream iff it carries something readable.
 *  Pure-zero disturbances with no resolution/message/articulation are noise. */
function hasContent(s: ExperienceSegment): boolean {
  if (s.message) return true;
  if (s.articulation) return true;
  if (s.resolution && s.resolution.changes.length > 0) return true;
  if (s.disturbance.total >= 1) return true;
  return false;
}

/** Does the entry have a body worth collapsing? Header-only entries show
 *  no disclosure triangle — nothing to hide. */
function hasBody(s: ExperienceSegment): boolean {
  if (s.message) return true;
  if (s.articulation) return true;
  if (s.resolution && s.resolution.changes.length > 0) return true;
  if (s.disturbance.displaced.length > 0) return true;
  if (s.sigils.length > 0) return true;
  return false;
}

export function ExperiencePanel() {
  const { getExperience } = useExperience();
  const ws = useWorkspaceState();
  const [pastSessions, setPastSessions] = useState<SessionGroup[]>([]);
  const [liveSegments, setLiveSegments] = useState<ExperienceSegment[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [expandedMore, setExpandedMore] = useState<Set<number>>(new Set());
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
      groups.sort((a, b) => b.startedAt - a.startedAt);
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
      listRef.current.scrollTop = 0;
    }
  }, [liveSegments.length]);

  const liveTimestamps = new Set(liveSegments.map(s => s.timestamp));
  const filteredPast = pastSessions.filter(g =>
    !g.segments.some(s => liveTimestamps.has(s.timestamp))
  );

  const liveMeaningful = liveSegments.filter(hasContent);
  const isEmpty = filteredPast.length === 0 && liveMeaningful.length === 0;

  // Flat list of all visible ids for collapse-all. Recomputed with data.
  const allVisibleIds = useMemo(() => {
    const ids: number[] = [];
    for (const seg of liveMeaningful) ids.push(seg.timestamp);
    for (const group of filteredPast) {
      for (const seg of group.segments.filter(hasContent)) ids.push(seg.timestamp);
    }
    return ids;
  }, [liveMeaningful, filteredPast]);

  const allCollapsed = allVisibleIds.length > 0 && allVisibleIds.every(id => collapsed.has(id));
  const toggleAll = () => {
    if (allCollapsed) {
      // Expand all — but do NOT touch expandedMore. Previously-hidden
      // "+N more" bodies stay hidden; the user's request.
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(allVisibleIds));
      // Collapsing entries implicitly hides "+N more" too (it's inside the
      // body), but keep expandedMore so individual re-expansion can restore
      // the prior substate if the user opens an entry back up. Non-goal.
    }
  };

  const toggleEntry = (ts: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(ts)) next.delete(ts); else next.add(ts);
      return next;
    });
  };
  const toggleMore = (ts: number) => {
    setExpandedMore(prev => {
      const next = new Set(prev);
      if (next.has(ts)) next.delete(ts); else next.add(ts);
      return next;
    });
  };

  return (
    <div className={styles.panel} ref={listRef}>
      {!isEmpty && (
        <div className={styles.toolbar}>
          <button
            className={styles.toolbarBtn}
            onClick={toggleAll}
            title={allCollapsed ? "Expand every entry. Nested +N more stays hidden." : "Collapse every entry to a one-line summary."}
          >
            {allCollapsed ? "expand all" : "collapse all"}
          </button>
        </div>
      )}
      {isEmpty ? (
        <div className={styles.empty}>No experience yet. Edit a sigil or start a conversation.</div>
      ) : (
        <>
          {liveMeaningful.length > 0 && (
            <div>
              <div className={styles.sessionHeader}>Now</div>
              {liveMeaningful.slice().reverse().map((seg) => (
                <Entry
                  key={seg.timestamp}
                  segment={seg}
                  collapsed={collapsed.has(seg.timestamp)}
                  onToggle={() => toggleEntry(seg.timestamp)}
                  moreExpanded={expandedMore.has(seg.timestamp)}
                  onToggleMore={() => toggleMore(seg.timestamp)}
                />
              ))}
            </div>
          )}
          {filteredPast.map((group, gi) => {
            const meaningful = group.segments.filter(hasContent);
            if (meaningful.length === 0) return null;
            return (
              <div key={gi}>
                <div className={styles.sessionHeader}>{group.label}</div>
                {meaningful.slice().reverse().map((seg) => (
                  <Entry
                    key={seg.timestamp}
                    segment={seg}
                    collapsed={collapsed.has(seg.timestamp)}
                    onToggle={() => toggleEntry(seg.timestamp)}
                    moreExpanded={expandedMore.has(seg.timestamp)}
                    onToggleMore={() => toggleMore(seg.timestamp)}
                  />
                ))}
              </div>
            );
          })}
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

interface EntryProps {
  segment: ExperienceSegment;
  collapsed: boolean;
  onToggle: () => void;
  moreExpanded: boolean;
  onToggleMore: () => void;
}

function Entry({ segment, collapsed, onToggle, moreExpanded, onToggleMore }: EntryProps) {
  const time = new Date(segment.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const { resolution, message, articulation } = segment;
  const body = hasBody(segment);

  return (
    <div className={`${styles.entry} ${segment.relevant ? styles.relevant : styles.muted} ${message ? styles.chatEntry : ""} ${articulation ? styles.articulationEntry : ""}`}>
      <div
        className={`${styles.entryHeader} ${body ? styles.entryHeaderClickable : ""}`}
        onClick={body ? onToggle : undefined}
      >
        {body && (
          <span
            className={`${styles.disclosure} ${collapsed ? "" : styles.disclosureOpen}`}
            aria-hidden="true"
          >▸</span>
        )}
        <span className={styles.time}>{timeStr}</span>
        {message && <span className={styles.role}>{message.role}</span>}
        {articulation && <span className={styles.role}>partner</span>}
        {segment.disturbance.total >= 1 && (
          <span className={styles.magnitude}>{segment.disturbance.total.toFixed(0)}</span>
        )}
        {collapsed && body && (
          <span className={styles.collapsedSummary}>{summarize(segment)}</span>
        )}
      </div>
      {!collapsed && (
        message ? (
          <div className={styles.chatMessage}>{message.content.slice(0, 200)}{message.content.length > 200 ? "..." : ""}</div>
        ) : articulation ? (
          <div className={styles.articulation}>
            <div className={styles.observation}>{articulation.observation}</div>
            {articulation.suggestions.length > 0 && (
              <div className={styles.suggestions}>
                {articulation.suggestions.map((s, i) => (
                  <div key={i} className={styles.suggestion}>{s}</div>
                ))}
              </div>
            )}
          </div>
        ) : resolution && resolution.changes.length > 0 ? (
          <div className={styles.narration}>
            {(moreExpanded ? resolution.changes : resolution.changes.slice(0, 4)).map((c, i) => (
              <div key={i} className={`${styles.change} ${styles[c.kind] ?? ""}`}>
                {c.description}
              </div>
            ))}
            {resolution.changes.length > 4 && (
              <button
                className={styles.moreBtn}
                onClick={(e) => { e.stopPropagation(); onToggleMore(); }}
                title={moreExpanded ? "Hide the rest" : `Show the other ${resolution.changes.length - 4}`}
              >
                {moreExpanded ? `− hide ${resolution.changes.length - 4}` : `+ ${resolution.changes.length - 4} more`}
              </button>
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
        )
      )}
    </div>
  );
}

/** One-line summary for the collapsed header. Picks the most informative
 *  fragment available so a collapsed row still signals what's inside. */
function summarize(s: ExperienceSegment): string {
  if (s.message) {
    const c = s.message.content;
    return c.length > 60 ? c.slice(0, 60) + "…" : c;
  }
  if (s.articulation) {
    const o = s.articulation.observation;
    return o.length > 60 ? o.slice(0, 60) + "…" : o;
  }
  if (s.resolution && s.resolution.changes.length > 0) {
    const n = s.resolution.changes.length;
    const first = s.resolution.changes[0].description;
    const head = first.length > 50 ? first.slice(0, 50) + "…" : first;
    return n > 1 ? `${head}  +${n - 1}` : head;
  }
  if (s.disturbance.displaced.length > 0) {
    return s.disturbance.displaced.map(d => d.name).slice(0, 3).join(", ");
  }
  if (s.sigils.length > 0) {
    return s.sigils.slice(0, 3).join(", ");
  }
  return "";
}
