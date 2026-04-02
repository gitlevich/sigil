import { useState, useRef, useEffect } from "react";
import type { Context } from "./types";
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext, buildPath } from "./utils";
import styles from "./Atlas.module.css";

// --- Treemap layout (Bruls, Huizing, van Wijk 1999) ---

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WeightedItem {
  ctx: Context;
  weight: number;
}

interface LayoutRect extends Rect {
  ctx: Context;
}

function computeWeight(ctx: Context): number {
  return 1 + ctx.children.reduce((s, c) => s + computeWeight(c), 0);
}

function squarify(items: WeightedItem[], rect: Rect): LayoutRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ ...rect, ctx: items[0].ctx }];
  }

  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  if (totalWeight === 0) return [];

  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const results: LayoutRect[] = [];
  layoutStrip(sorted, rect, totalWeight, results);
  return results;
}

function layoutStrip(
  items: WeightedItem[],
  rect: Rect,
  totalWeight: number,
  results: LayoutRect[]
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    results.push({ ...rect, ctx: items[0].ctx });
    return;
  }

  const isWide = rect.w >= rect.h;
  let rowWeight = 0;
  let bestAspect = Infinity;
  let splitAt = 1;

  for (let i = 0; i < items.length; i++) {
    rowWeight += items[i].weight;
    const rowFraction = rowWeight / totalWeight;
    const stripSize = isWide ? rect.w * rowFraction : rect.h * rowFraction;
    const crossSize = isWide ? rect.h : rect.w;

    let worst = 0;
    let runWeight = 0;
    for (let j = 0; j <= i; j++) {
      runWeight += items[j].weight;
      const itemFraction = items[j].weight / rowWeight;
      const itemSize = crossSize * itemFraction;
      const aspect = Math.max(stripSize / itemSize, itemSize / stripSize);
      worst = Math.max(worst, aspect);
    }

    if (worst <= bestAspect) {
      bestAspect = worst;
      splitAt = i + 1;
    } else {
      break;
    }
  }

  const rowItems = items.slice(0, splitAt);
  const restItems = items.slice(splitAt);
  const rowTotalWeight = rowItems.reduce((s, it) => s + it.weight, 0);
  const rowFraction = rowTotalWeight / totalWeight;

  let rowRect: Rect;
  let restRect: Rect;

  if (isWide) {
    const stripW = rect.w * rowFraction;
    rowRect = { x: rect.x, y: rect.y, w: stripW, h: rect.h };
    restRect = { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
  } else {
    const stripH = rect.h * rowFraction;
    rowRect = { x: rect.x, y: rect.y, w: rect.w, h: stripH };
    restRect = { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
  }

  let offset = 0;
  for (const item of rowItems) {
    const fraction = item.weight / rowTotalWeight;
    if (isWide) {
      const itemH = rowRect.h * fraction;
      results.push({ x: rowRect.x, y: rowRect.y + offset, w: rowRect.w, h: itemH, ctx: item.ctx });
      offset += itemH;
    } else {
      const itemW = rowRect.w * fraction;
      results.push({ x: rowRect.x + offset, y: rowRect.y, w: itemW, h: rowRect.h, ctx: item.ctx });
      offset += itemW;
    }
  }

  if (restItems.length > 0) {
    layoutStrip(restItems, restRect, totalWeight - rowTotalWeight, results);
  }
}

// --- Depth styling ---

function maxDepth(ctx: Context): number {
  if (ctx.children.length === 0) return 0;
  return 1 + Math.max(...ctx.children.map(maxDepth));
}

function depthStyle(
  depth: number,
  totalDepth: number,
  dark: boolean
): React.CSSProperties {
  const rootL = dark ? 12 : 95;
  const leafL = dark ? 30 : 70;
  const range = Math.abs(leafL - rootL);
  const step = totalDepth > 0 ? range / totalDepth : 0;
  const lightness = dark
    ? Math.min(leafL, rootL + depth * step)
    : Math.max(leafL, rootL - depth * step);
  const bg = `hsl(0, 0%, ${lightness}%)`;
  const color = lightness > 45 ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 90%)";
  return { background: bg, color };
}

// --- Components ---

const HEADER_HEIGHT = 28;
const ICON_ROW_HEIGHT = 24;
const FRAME_PAD = 6;

function TreemapRect({
  layout,
  depth,
  totalDepth,
  revealed,
  selectedName,
  dark,
  onSelect,
  onNavigate,
}: {
  layout: LayoutRect;
  depth: number;
  totalDepth: number;
  revealed: boolean;
  selectedName: string | null;
  dark: boolean;
  onSelect: (name: string) => void;
  onNavigate: (ctx: Context) => void;
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
        />
      ))}
    </div>
  );
}

export function Atlas() {
  const { sigil, currentPath, theme } = useViewerState();
  const dispatch = useViewerDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [revealed, setRevealed] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const currentCtx = findContext(sigil.root, currentPath);
  const children = currentCtx.children;

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

  const handleNavigate = (ctx: Context) => {
    const path = buildPath(sigil.root, ctx.name, []);
    if (path) {
      dispatch({ type: "NAVIGATE", path });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && currentPath.length > 1) {
        dispatch({ type: "NAVIGATE", path: currentPath.slice(0, -1) });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPath, dispatch]);

  const items: WeightedItem[] = children.map((c) => ({
    ctx: c,
    weight: computeWeight(c),
  }));
  const rootRect: Rect = { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
  const layouts = children.length > 0 ? squarify(items, rootRect) : [];
  const deepest =
    children.length > 0
      ? Math.max(...children.map((c) => maxDepth(c))) + 1
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
              dark={theme === "dark"}
              onSelect={setSelectedName}
              onNavigate={handleNavigate}
            />
          ))
        )}
      </div>

      <div className={styles.modeSwitch}>
        <button
          className={`${styles.modeSwitchBtn} ${!revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => setRevealed(false)}
          title="Focused - one level"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button
          className={`${styles.modeSwitchBtn} ${revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => setRevealed(true)}
          title="Revealed - all levels"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <rect x="4" y="4" width="8" height="8" rx="0.5" />
          </svg>
        </button>
      </div>

      <div className={styles.instructions}>
        Double-click to enter a context.
      </div>
    </div>
  );
}
