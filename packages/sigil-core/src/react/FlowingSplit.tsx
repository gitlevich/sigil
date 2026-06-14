/**
 * FlowingSplit — two-pane vertical split for the "flowing" layout mode.
 *
 * Left: typing surface. Right: the spatial desktop where the world emerges
 * as the prose names it. Draggable divider in the middle; split ratio
 * persists to localStorage so the panes remember their balance.
 */
import { type ReactNode, useCallback, useRef, useState } from "react";
import styles from "./FlowingSplit.module.css";

const STORAGE_KEY = "sigil.flowing.leftFrac";
const DEFAULT_FRAC = 0.5;
const MIN_FRAC = 0.25;
const MAX_FRAC = 0.75;

function loadFrac(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FRAC;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return DEFAULT_FRAC;
    return Math.min(MAX_FRAC, Math.max(MIN_FRAC, n));
  } catch {
    return DEFAULT_FRAC;
  }
}

function saveFrac(n: number): void {
  try { localStorage.setItem(STORAGE_KEY, String(n.toFixed(3))); } catch { /* ignore */ }
}

export interface FlowingSplitProps {
  left: ReactNode;
  right: ReactNode;
}

export function FlowingSplit({ left, right }: FlowingSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [frac, setFrac] = useState<number>(() => loadFrac());
  const [dragging, setDragging] = useState<boolean>(false);

  const onDividerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return;
      const f = (ev.clientX - rect.left) / rect.width;
      setFrac(Math.min(MAX_FRAC, Math.max(MIN_FRAC, f)));
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      setFrac((f) => { saveFrac(f); return f; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const leftPct = (frac * 100).toFixed(3) + "%";
  const rightPct = ((1 - frac) * 100).toFixed(3) + "%";

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={`${styles.pane} ${styles.left}`} style={{ width: leftPct }}>
        {left}
      </div>
      <div
        className={`${styles.divider} ${dragging ? styles.active : ""}`}
        onPointerDown={onDividerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize split"
      />
      <div className={`${styles.pane} ${styles.right}`} style={{ width: `calc(${rightPct} - 6px)` }}>
        {right}
      </div>
    </div>
  );
}
