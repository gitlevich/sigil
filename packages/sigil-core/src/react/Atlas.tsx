import { useState, useRef, useEffect } from "react";
import type { Sigil } from "../types";
import {
  computeWeight, maxDepth, squarify, depthStyle,
  HEADER_HEIGHT, ICON_ROW_HEIGHT, FRAME_PAD,
  type Rect, type WeightedItem, type LayoutRect,
} from "../treemap";
import styles from "./Atlas.module.css";

function TreemapRect({
  layout,
  depth,
  totalDepth,
  revealed,
  selectedName,
  dark,
  onSelect,
  onNavigate,
  onContextMenu,
}: {
  layout: LayoutRect;
  depth: number;
  totalDepth: number;
  revealed: boolean;
  selectedName: string | null;
  dark: boolean;
  onSelect: (name: string) => void;
  onNavigate: (sigil: Sigil) => void;
  onContextMenu?: (e: React.MouseEvent, sigil: Sigil) => void;
}) {
  const { ctx, x, y, w, h } = layout;
  const isSelected = selectedName === ctx.name;
  const hasIcons = ctx.invariants.length > 0 || ctx.affordances.length > 0;
  const showIcons = hasIcons && w > 30 && h > 46;

  const childLayouts =
    revealed && ctx.children.length > 0
      ? (() => {
          const contentTop = HEADER_HEIGHT + (showIcons ? ICON_ROW_HEIGHT : 0);
          const innerRect: Rect = {
            x: FRAME_PAD,
            y: contentTop,
            w: Math.max(0, w - FRAME_PAD * 2),
            h: Math.max(0, h - contentTop - FRAME_PAD),
          };
          if (innerRect.w < 10 || innerRect.h < 10) return [];
          const items: WeightedItem[] = ctx.children.map((c) => ({
            ctx: c,
            weight: computeWeight(c),
          }));
          return squarify(items, innerRect);
        })()
      : [];

  return (
    <div
      className={`${styles.rect} ${isSelected ? styles.rectSelected : ""}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        ...depthStyle(depth, totalDepth, dark),
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(ctx.name);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onNavigate(ctx);
      }}
      onContextMenu={onContextMenu ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, ctx);
      } : undefined}
    >
      {w > 30 && h > 16 && (
        <div className={styles.rectLabel}>{ctx.name}</div>
      )}
      {showIcons && (
        <div className={styles.rectIcons}>
          {ctx.invariants.map((c) => (
            <span
              key={`c-${c.name}`}
              className={styles.iconWrap}
              title={`!${c.name}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <line
                  x1="7" y1="1" x2="7" y2="12"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                />
                <circle cx="7" cy="4.5" r="2" fill="#f40009" />
              </svg>
            </span>
          ))}
          {ctx.affordances.map((a) => (
            <span
              key={`a-${a.name}`}
              className={styles.iconWrap}
              title={`#${a.name}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <rect
                  x="2" y="2" width="4" height="10" rx="1"
                  fill="none" stroke="currentColor" strokeWidth="1.2"
                />
                <path
                  d="M6 7 L11 7 L12 9"
                  fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </span>
          ))}
        </div>
      )}
      {childLayouts.map((cl) => (
        <TreemapRect
          key={cl.ctx.name}
          layout={cl}
          depth={depth + 1}
          totalDepth={totalDepth}
          revealed={revealed}
          selectedName={selectedName}
          dark={dark}
          onSelect={onSelect}
          onNavigate={onNavigate}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export interface AtlasProps {
  /** The children of the current sigil to display in the treemap. */
  children: Sigil[];
  /** Whether the theme is dark. */
  dark: boolean;
  /** Called when a context is double-clicked to navigate into it. */
  onNavigate: (sigil: Sigil) => void;
  /** Called when Escape is pressed to go up one level. */
  onEscape?: () => void;
  /** Called when a context is right-clicked. If not provided, no context menu behavior. */
  onContextMenu?: (e: React.MouseEvent, sigil: Sigil) => void;
  /** Instructions text shown at the bottom. */
  instructions?: string;
  /** localStorage key for persisting revealed/focused mode. Defaults to "sigil-atlas-revealed". */
  revealedStorageKey?: string;
}

export function Atlas({
  children: contexts,
  dark,
  onNavigate,
  onEscape,
  onContextMenu,
  instructions = "Double-click to enter a sigil.",
  revealedStorageKey = "sigil-atlas-revealed",
}: AtlasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [revealed, setRevealed] = useState(() => {
    const stored = localStorage.getItem(revealedStorageKey);
    return stored === null ? true : stored === "true";
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!onEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape]);

  const items: WeightedItem[] = contexts.map((c) => ({
    ctx: c,
    weight: computeWeight(c),
  }));
  const rootRect: Rect = { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
  const layouts = contexts.length > 0 ? squarify(items, rootRect) : [];
  const deepest =
    contexts.length > 0
      ? Math.max(...contexts.map((c) => maxDepth(c))) + 1
      : 0;

  return (
    <div className={styles.container}>
      <div
        ref={containerRef}
        className={styles.treemap}
        onClick={() => setSelectedName(null)}
      >
        {layouts.length === 0 ? (
          <div className={styles.empty}>No sub-contexts to show.</div>
        ) : (
          layouts.map((layout) => (
            <TreemapRect
              key={layout.ctx.name}
              layout={layout}
              depth={0}
              totalDepth={deepest}
              revealed={revealed}
              selectedName={selectedName}
              dark={dark}
              onSelect={setSelectedName}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
            />
          ))
        )}
      </div>

      <div className={styles.modeSwitch}>
        <button
          className={`${styles.modeSwitchBtn} ${!revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => { setRevealed(false); localStorage.setItem(revealedStorageKey, "false"); }}
          title="Focused - one level"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button
          className={`${styles.modeSwitchBtn} ${revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => { setRevealed(true); localStorage.setItem(revealedStorageKey, "true"); }}
          title="Revealed - all levels"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <rect x="4" y="4" width="8" height="8" rx="0.5" />
          </svg>
        </button>
      </div>

      <div className={styles.instructions}>
        {instructions}
      </div>
    </div>
  );
}
