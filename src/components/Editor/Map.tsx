import { useState, useRef, useEffect } from "react";
import { useDocument, useAppDispatch } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useSigil } from "../../hooks/useSigil";
import styles from "./Map.module.css";

// --- Treemap layout ---

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

/** Recursive weight: 1 (self) + descendant sigil count. A leaf weighs 1. */
function computeWeight(ctx: Context): number {
  return 1 + ctx.children.reduce((s, c) => s + computeWeight(c), 0);
}

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk 1999).
 * Partitions `items` into `rect`, producing one LayoutRect per item.
 */
function squarify(items: WeightedItem[], rect: Rect): LayoutRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ ...rect, ctx: items[0].ctx }];
  }

  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  if (totalWeight === 0) return [];

  // Sort descending by weight for better aspect ratios
  const sorted = [...items].sort((a, b) => b.weight - a.weight);

  const results: LayoutRect[] = [];
  layoutStrip(sorted, rect, totalWeight, results);
  return results;
}

function layoutStrip(
  items: WeightedItem[],
  rect: Rect,
  totalWeight: number,
  results: LayoutRect[],
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    results.push({ ...rect, ctx: items[0].ctx });
    return;
  }

  const isWide = rect.w >= rect.h;

  // Greedily add items to current row until aspect ratio worsens
  let rowWeight = 0;
  let bestAspect = Infinity;
  let splitAt = 1;

  for (let i = 0; i < items.length; i++) {
    rowWeight += items[i].weight;
    const rowFraction = rowWeight / totalWeight;
    const stripSize = isWide ? rect.w * rowFraction : rect.h * rowFraction;
    const crossSize = isWide ? rect.h : rect.w;

    // Worst aspect ratio in this row
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

  // Lay out the row
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

  // Place items within the row strip
  let offset = 0;
  for (const item of rowItems) {
    const fraction = item.weight / rowTotalWeight;
    if (isWide) {
      const itemH = rowRect.h * fraction;
      results.push({
        x: rowRect.x,
        y: rowRect.y + offset,
        w: rowRect.w,
        h: itemH,
        ctx: item.ctx,
      });
      offset += itemH;
    } else {
      const itemW = rowRect.w * fraction;
      results.push({
        x: rowRect.x + offset,
        y: rowRect.y,
        w: itemW,
        h: rowRect.h,
        ctx: item.ctx,
      });
      offset += itemW;
    }
  }

  // Recurse for remaining items
  if (restItems.length > 0) {
    const restWeight = totalWeight - rowTotalWeight;
    layoutStrip(restItems, restRect, restWeight, results);
  }
}

// --- Depth styling: greyscale, deepest is darkest, leaves are near-white ---

/** Compute the maximum nesting depth of a context tree. */
function maxDepth(ctx: Context): number {
  if (ctx.children.length === 0) return 0;
  return 1 + Math.max(...ctx.children.map(maxDepth));
}

// Root matches app background, leaves are most contrasting. Step calculated from max depth.
function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function depthStyle(depth: number, totalDepth: number): React.CSSProperties {
  const dark = isDarkTheme();
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

function findContext(root: Context, path: string[]): Context {
  let current = root;
  for (const seg of path) {
    const child = current.children.find((c) => c.name === seg);
    if (!child) return current;
    current = child;
  }
  return current;
}

const HEADER_HEIGHT = 28;
const ICON_ROW_HEIGHT = 24;
const FRAME_PAD = 6;

function TreemapRect({
  layout,
  depth,
  totalDepth,
  revealed,
  selectedName,
  onSelect,
  onNavigate,
  onContextMenu,
}: {
  layout: LayoutRect;
  depth: number;
  totalDepth: number;
  revealed: boolean;
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNavigate: (ctx: Context) => void;
  onContextMenu: (e: React.MouseEvent, ctx: Context) => void;
}) {
  const { ctx, x, y, w, h } = layout;
  const isSelected = selectedName === ctx.name;
  const hasIcons = ctx.signals.length > 0 || ctx.affordances.length > 0;
  const showIcons = hasIcons && w > 30 && h > 46;

  // In revealed mode, compute nested children layout
  const childLayouts = revealed && ctx.children.length > 0
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

  // Labels use --content-font-size via CSS; no inline override needed

  return (
    <div
      className={`${styles.rect} ${isSelected ? styles.rectSelected : ""}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        ...depthStyle(depth, totalDepth),
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(ctx.name); }}
      onDoubleClick={(e) => { e.stopPropagation(); onNavigate(ctx); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, ctx); }}
    >
      {w > 30 && h > 16 && (
        <div className={styles.rectLabel}>
          {ctx.name}
        </div>
      )}
      {showIcons && (
        <div className={styles.rectIcons}>
          {ctx.signals.map((c) => (
            <span key={`c-${c.name}`} className={styles.iconWrap} title={`!${c.name}`}>
              <svg width="14" height="14" viewBox="0 0 14 14">
                {/* Signal: concentric arcs from a point */}
                <circle cx="7" cy="11" r="1.5" fill="currentColor" />
                <path d="M4.5 9 a3.5 3.5 0 0 1 5 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M2 6.5 a6 6 0 0 1 10 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
          ))}
          {ctx.affordances.map((a) => (
            <span key={`a-${a.name}`} className={styles.iconWrap} title={`#${a.name}`}>
              <svg width="14" height="14" viewBox="0 0 14 14">
                {/* Door handle: plate + lever */}
                <rect x="2" y="2" width="4" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 7 L11 7 L12 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
          onSelect={onSelect}
          onNavigate={onNavigate}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export function SigilMap() {
  const doc = useDocument();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [revealed, setRevealed] = useState(() => {
    const stored = localStorage.getItem("sigil-map-revealed");
    return stored === null ? true : stored === "true";
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; ctx: Context } | null>(null);
  const { reload } = useSigil();

  const currentCtx = doc ? findContext(doc.sigil.root, doc.currentPath) : null;
  const children = currentCtx?.children ?? [];

  // Measure container
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

  // Dismiss context menu on click
  useEffect(() => {
    if (!nodeMenu) return;
    const hide = () => setNodeMenu(null);
    document.addEventListener("click", hide);
    return () => document.removeEventListener("click", hide);
  }, [nodeMenu]);

  const handleNavigate = (ctx: Context) => {
    if (!doc) return;
    // Build path from root to this context
    const path = buildPath(doc.sigil.root, ctx.name, []);
    if (path) {
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } });
    }
  };

  if (!doc) return null;

  // Compute layout and max depth for greyscale scaling
  const items: WeightedItem[] = children.map((c) => ({
    ctx: c,
    weight: computeWeight(c),
  }));
  const rootRect: Rect = { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
  const layouts = children.length > 0 ? squarify(items, rootRect) : [];
  const deepest = children.length > 0 ? Math.max(...children.map((c) => maxDepth(c))) + 1 : 0;

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
              onSelect={setSelectedName}
              onNavigate={handleNavigate}
              onContextMenu={(e, ctx) => setNodeMenu({ x: e.clientX, y: e.clientY, ctx })}
            />
          ))
        )}
      </div>

      <div className={styles.modeSwitch}>
        <button
          className={`${styles.modeSwitchBtn} ${!revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => { setRevealed(false); localStorage.setItem("sigil-map-revealed", "false"); }}
          title="Focused — one level"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button
          className={`${styles.modeSwitchBtn} ${revealed ? styles.modeSwitchActive : ""}`}
          onClick={() => { setRevealed(true); localStorage.setItem("sigil-map-revealed", "true"); }}
          title="Revealed — all levels"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <rect x="4" y="4" width="8" height="8" rx="0.5" />
          </svg>
        </button>
      </div>

      <div className={styles.instructions}>
        Double-click to enter a context. Right-click for options.
      </div>

      {nodeMenu && (
        <div
          className={styles.nodeContextMenu}
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.menuHeader}>{nodeMenu.ctx.name}</div>
          <div className={styles.menuList}>
            <button
              className={styles.menuItem}
              onClick={() => {
                const name = prompt("Rename:", nodeMenu.ctx.name);
                if (!name?.trim()) { setNodeMenu(null); return; }
                api.renameContext(doc!.sigil.root_path, nodeMenu.ctx.path, name.trim())
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
                setNodeMenu(null);
              }}
            >
              Rename
            </button>
            <button
              className={styles.menuItem}
              onClick={() => {
                api.revealInFinder(nodeMenu.ctx.path).catch(console.error);
                setNodeMenu(null);
              }}
            >
              Open in Finder
            </button>
            <button
              className={styles.menuItemDanger}
              onClick={() => {
                if (!confirm(`Delete "${nodeMenu.ctx.name}" and all its contents?`)) { setNodeMenu(null); return; }
                api.deleteContext(nodeMenu.ctx.path)
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
                setNodeMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Find path from root to a context by name (DFS). */
function buildPath(ctx: Context, targetName: string, path: string[]): string[] | null {
  for (const child of ctx.children) {
    const childPath = [...path, child.name];
    if (child.name === targetName) return childPath;
    const found = buildPath(child, targetName, childPath);
    if (found) return found;
  }
  return null;
}
