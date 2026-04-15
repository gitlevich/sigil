/**
 * ExperienceJournal — the time-like view of ContrastSpace.
 *
 * A draggable floating panel showing the live stream of experience segments.
 * Non-blocking — you can keep editing while it's open.
 * Drag the header to reposition. Toggled via Ctrl-6, dismissed with Escape.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useExperience } from "../../state/ExperienceContext";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";
import styles from "./ExperienceJournal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ExperienceJournal({ open, onClose }: Props) {
  const getExperience = useExperience();
  const [segments, setSegments] = useState<ExperienceSegment[]>([]);
  const [position, setPosition] = useState({ x: window.innerWidth - 360, y: 80 });
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSegments(getExperience());
    const interval = setInterval(() => setSegments(getExperience()), 1000);
    return () => clearInterval(interval);
  }, [open, getExperience]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [segments.length]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - dragging.current.startX;
      const dy = ev.clientY - dragging.current.startY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 100, dragging.current.origX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, dragging.current.origY + dy)),
      });
    };

    const onMouseUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [position]);

  if (!open) return null;

  return (
    <div className={styles.floating} style={{ left: position.x, top: position.y }}>
      <div className={styles.header} onMouseDown={onMouseDown}>
        <span className={styles.title}>Experience</span>
        <span className={styles.subtitle}>time-like</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">Esc</button>
      </div>
      <div className={styles.list} ref={listRef}>
        {segments.length === 0 ? (
          <div className={styles.empty}>No disturbances yet. Edit a sigil.</div>
        ) : (
          segments.map((seg, i) => <ExperienceEntry key={i} segment={seg} />)
        )}
      </div>
    </div>
  );
}

function ExperienceEntry({ segment }: { segment: ExperienceSegment }) {
  const time = new Date(segment.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const total = segment.disturbance.total;
  const displaced = segment.disturbance.displaced.slice(0, 5);

  return (
    <div className={`${styles.entry} ${segment.relevant ? styles.relevant : styles.muted} ${total > 4 ? styles.escalation : ""}`}>
      <div className={styles.entryHeader}>
        <span className={styles.time}>{timeStr}</span>
        {total > 0 && (
          <span className={styles.magnitude} style={{ opacity: Math.min(1, 0.3 + total * 0.15) }}>
            {total.toFixed(0)}
          </span>
        )}
      </div>
      <div className={styles.sigils}>
        {segment.sigils.map(name => (
          <span key={name} className={styles.sigilTag}>{name}</span>
        ))}
      </div>
      {displaced.length > 0 && (
        <div className={styles.displaced}>
          {displaced.map(d => (
            <span key={d.name} className={styles.displacedItem}>
              <span className={styles.bar} style={{ width: `${Math.min(100, d.magnitude * 20)}%` }} />
              <span className={styles.displacedName}>{d.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
