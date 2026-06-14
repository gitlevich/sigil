/**
 * SpatialDesktop — the from-inside mode of @Spatial.
 *
 * A flat canvas of icons, one per sigil I am currently entangled with. Shape
 * encodes ring: Children are filled squares, Neighbors are circles, Gods are
 * funnel silhouettes, the structural parent is an upward chevron. Positions
 * persist per sigil in `spatial.layout.json`; unplaced icons fall back to a
 * deterministic hashed default.
 *
 * Phase A: Children + structural parent. Neighbors and Gods land next.
 */
import type { ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { regionPosition, type IconPosition, type SpatialLayout, type ScrollPanelLayout, type IconKindForLayout } from "../spatialLayout";
import { extractArcs, arcLabel, type ArcScope } from "../sentenceArcs";
import { extractEntanglements } from "../entanglements";
import type { Sigil } from "../types";
import { findContext } from "../tree";
import { stripFrontmatter } from "../frontmatter";
import styles from "./SpatialDesktop.module.css";

// The 3D "Outside" view pulls in three.js — a heavy dependency. Load it lazily
// so it only downloads when the user actually opens Outside, keeping the rest
// of the app (and the web viewer's landing page) lean.
const StructuralView3D = lazy(() =>
  import("./StructuralView3D").then((m) => ({ default: m.StructuralView3D })),
);

type IconKind = "child" | "neighbor" | "god" | "parent" | "narrative" | "affordance" | "invariant" | "landmark";

interface IconSpec {
  name: string;
  kind: IconKind;
  navigateTo?: string[]; // absolute path in the workspace tree — undefined for body-facet icons
  peek?: PeekData | null; // summary + facets shown on hover
}

interface PeekData {
  thesis: string;
  affordances: string[];
  invariants: string[];
}

/** First sentence (up to ~160 chars) of a sigil's language.md — its thesis. */
function extractThesisSentence(language: string): string {
  const body = stripFrontmatter(language ?? "")
    // drop headings
    .replace(/^#+\s+.*$/gm, "")
    .trim();
  if (!body) return "";
  // Split on the first .!? or blank-line boundary.
  const m = body.match(/^([\s\S]*?[.!?])(\s|$)/);
  const first = (m ? m[1] : body.split(/\n\n/)[0]).trim();
  return first.length > 180 ? first.slice(0, 177) + "…" : first;
}

function buildPeek(target: Sigil | null): PeekData | null {
  if (!target) return null;
  return {
    thesis: extractThesisSentence(target.language ?? ""),
    affordances: (target.affordances ?? []).map((a) => a.name),
    invariants: (target.invariants ?? []).map((i) => i.name),
  };
}

const NARRATIVE_NAME = "Language";

/**
 * Glyph bounding box per kind, used both to position the icon's visual center
 * on its stored (x, y) and to compute arc trim so lines meet at the glyph's
 * edge rather than disappearing under it.
 */
/**
 * Size hierarchy, deliberately stepped. The base unit is 24px.
 *
 *   Parent (one true god)       6u  (144)  —  dominant scope
 *   God (emergent)              4u  (96)   —  pull of a shared name
 *   Neighbor (door)             3u × 4u   —  tall enough to hold a name
 *   Child                       3u  (72)   —  a peer I named
 *   Narrative                   2u × 2.5u — a surface on my body
 *   Affordance, Invariant       1u  (24)   —  a body facet
 *
 * Doors and narrative are rectangles because they are apertures/surfaces,
 * not entities — their aspect ratio reflects that.
 */
const UNIT = 24;
function glyphSize(kind: IconKind): { w: number; h: number } {
  switch (kind) {
    case "parent":    return { w: UNIT * 4, h: Math.round(UNIT * 4 * 0.866) }; // equilateral 96×83, same as god
    case "god":       return { w: UNIT * 4, h: Math.round(UNIT * 4 * 0.866) }; // equilateral 96×83
    case "neighbor":  return { w: 48, h: 76 };                                  // slim door
    case "child":     return { w: UNIT * 3, h: UNIT * 3 };                     // 72×72
    case "narrative": return { w: UNIT * 2, h: Math.round(UNIT * 2.5) };       // 48×60
    case "landmark":  return { w: UNIT * 2, h: UNIT * 2 };                     // 48×48 diamond
    case "affordance":
    case "invariant": return { w: UNIT, h: UNIT };                             // 24×24
  }
}

// No more per-shape trim — arcs go center to center, and the glyph's
// opaque fill occludes the interior portion. The line naturally terminates
// at the glyph's silhouette regardless of shape.

const SAVE_DEBOUNCE_MS = 400;

export interface SpatialDesktopProps {
  /** The currently-inhabited sigil. */
  folder: Sigil | null;
  /** Absolute path to the folder in the workspace tree. */
  currentPath: string[];
  /** Display name of the app root, used for the ascend label at depth 1. */
  rootName: string;
  /** Root of the main spec tree. */
  mainRoot: Sigil;
  /** Root of the imported-ontologies subtree, if any. */
  importedRoot?: Sigil | null;
  navigate: (path: string[]) => void;
  /** Read a sigil's persisted layout. The editor reads the file via Tauri; the
   * web viewer returns a layout baked into the exported spec. */
  readLayout: (folder: Sigil) => Promise<SpatialLayout>;
  /** Persist a sigil's layout. The web viewer passes a no-op (read-only). */
  writeLayout: (folder: Sigil, layout: SpatialLayout) => Promise<void>;
  /** Theme, forwarded to the 3D "Outside" view. */
  dark: boolean;
  /** Optional "Through" POV mode. When omitted, the Through button is hidden. */
  renderThrough?: () => ReactNode;
}

export function SpatialDesktop({
  folder: folderProp,
  currentPath,
  rootName,
  mainRoot,
  importedRoot,
  navigate,
  readLayout,
  writeLayout,
  dark,
  renderThrough,
}: SpatialDesktopProps) {
  // Bind to a const so TypeScript preserves `!folder` narrowing inside the
  // nested pointer-handler closures, the way it did for the editor's original
  // `const folder = resolveCurrentFolder(ws)`.
  const folder = folderProp;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [layout, setLayout] = useState<SpatialLayout | null>(null);
  // Which sigil's path does the loaded layout belong to? Used to gate the
  // LanguageScrollPanel so it only renders once the layout in memory matches
  // the current folder — otherwise navigating between sigils briefly mounts
  // the panel with the previous sigil's scroll, overwriting its local state.
  const [layoutPath, setLayoutPath] = useState<string | null>(null);
  const [mode, setMode] = useState<"inside" | "outside" | "through">("inside");
  const [scrollOpen, setScrollOpen] = useState<boolean>(false);
  const [arcScope, setArcScope] = useState<ArcScope>("sentence");
  const [hoveredIcon, setHoveredIcon] = useState<{ icon: IconSpec; rect: DOMRect } | null>(null);
  // Desktop selection — a cluster of icons I've caught inside a rubber-band
  // sweep, or a single icon I've pressed. Dragging any selected icon carries
  // the whole cluster by the same translation. A plain click on empty canvas
  // dissolves the cluster; a drag on empty canvas composes a new one. A
  // shift or meta modifier during the sweep extends the existing cluster
  // rather than replacing it, the way macOS Finder does.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Row-tooltip hover state lives in React so the tooltip can be portal-rendered
  // at document.body and escape .root's overflow: hidden. CSS :hover can't do
  // that — a tooltip inside a clipped container is always clipped.
  const [rowTip, setRowTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const hoverLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  // Stable identity for the inhabited sigil — used to gate per-sigil layout
  // loading and the scroll panel. Replaces the editor's folder.path, which the
  // web viewer doesn't have.
  const folderKey = currentPath.join(" ");

  // Track canvas size so default positions map to real pixels.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load layout when the inhabited sigil changes. Each sigil carries its own
  // memory: icon positions, scroll size and position, and whether the scroll
  // was open when I last left. Opening state flows from the loaded layout.
  useEffect(() => {
    if (!folder) { setLayout(null); setLayoutPath(null); return; }
    let cancelled = false;
    readLayout(folder).then((l) => {
      if (cancelled) return;
      setLayout(l);
      setLayoutPath(folderKey);
      setScrollOpen(l.scroll?.open ?? false);
    });
    return () => { cancelled = true; };
  }, [folderKey]);

  // A cluster belongs to the sigil it was composed in. Leave this sigil, drop it.
  useEffect(() => { setSelected(new Set()); setMarquee(null); }, [folderKey]);

  // Debounced save: whenever the layout changes, write it out after a pause.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSave = useCallback((target: Sigil, next: SpatialLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeLayout(target, next).catch((err) => console.error("spatial layout save failed:", err));
    }, SAVE_DEBOUNCE_MS);
  }, [writeLayout]);

  // Ascension target — the containing sigil. Rendered as a separate UP
  // button, not as a canvas icon.
  const ascend = useMemo(() => {
    if (currentPath.length === 0) return null;
    const parentPath = currentPath.slice(0, -1);
    const parentName = parentPath.length === 0
      ? (currentPath[0] === "Imported Ontologies" ? "Imported Ontologies" : rootName)
      : parentPath[parentPath.length - 1];
    return { name: parentName, path: parentPath };
  }, [currentPath, rootName]);

  // Derive the icons for the current sigil, with peek data (thesis, affordances,
  // invariants) attached so hovering any icon reveals what that sigil offers.
  const icons: IconSpec[] = useMemo(() => {
    if (!folder) return [];
    const list: IconSpec[] = [];
    const isImported = currentPath[0] === "Imported Ontologies";

    // Resolve a path within the workspace tree back to its Sigil so we can
    // read language/affordances/invariants for peek data.
    const resolveFolder = (path: string[]): Sigil | null => {
      if (path.length === 0) return null;
      if (path[0] === "Imported Ontologies") {
        if (!importedRoot) return null;
        return findContext(importedRoot, path.slice(1)) as Sigil | null;
      }
      if (!mainRoot) return null;
      return findContext(mainRoot, path) as Sigil | null;
    };

    // Narrative — my own body's language. Peek shows my own thesis.
    list.push({ name: NARRATIVE_NAME, kind: "narrative", peek: buildPeek(folder) });

    for (const child of folder.children) {
      list.push({
        name: child.name,
        kind: "child",
        navigateTo: [...currentPath, child.name],
        peek: buildPeek(child),
      });
    }

    const childNames = folder.children.map((c) => c.name);
    const entanglementRoot = (isImported ? importedRoot : mainRoot) as Sigil;
    const resolvedCurrentPath = isImported ? currentPath.slice(1) : currentPath;
    const entanglements = extractEntanglements(
      folder.language ?? "",
      entanglementRoot,
      resolvedCurrentPath,
      importedRoot ?? null,
      childNames,
      isImported ? ["Imported Ontologies"] : [],
    );
    for (const ent of entanglements) {
      list.push({
        name: ent.name,
        kind: ent.kind,
        navigateTo: ent.path,
        peek: buildPeek(resolveFolder(ent.path)),
      });
    }
    // A sigil I'm entangled with is one sigil regardless of how I relate
    // to it. If the same name has already been placed (as narrative,
    // child, or an earlier entanglement), the later classification is a
    // duplicate relation, not a new body on the desktop. Keep the first.
    const seenNames = new Set<string>();
    const unique: IconSpec[] = [];
    for (const icon of list) {
      if (seenNames.has(icon.name)) continue;
      seenNames.add(icon.name);
      unique.push(icon);
    }
    return unique;
  }, [folder, currentPath, rootName, mainRoot, importedRoot]);

  // Per-kind indices for region-based placement. Preserves appearance order
  // inside each kind so new items fall at the next slot, not random.
  const kindIndex = useMemo(() => {
    const counters: Record<string, number> = {};
    const byName = new Map<string, { kind: IconKind; index: number }>();
    for (const icon of icons) {
      // Affordances and invariants live in fixed rows, not on the canvas.
      if (icon.kind === "affordance" || icon.kind === "invariant") continue;
      const n = counters[icon.kind] ?? 0;
      byName.set(icon.name, { kind: icon.kind, index: n });
      counters[icon.kind] = n + 1;
    }
    return { byName, counters };
  }, [icons]);

  const positionFor = useCallback((name: string): IconPosition => {
    const entry = kindIndex.byName.get(name);
    if (!entry) return { x: size.w / 2, y: size.h / 2 };
    // User-dragged positions win for every icon. The region default is only
    // the initial placement; once dragged, the sigil owns its layout.
    const stored = layout?.icons[name];
    if (stored) return stored;
    const kindForLayout = entry.kind as IconKindForLayout;
    const count = kindIndex.counters[entry.kind] ?? 1;
    return regionPosition(kindForLayout, entry.index, count, size.w, size.h);
  }, [layout, size, kindIndex]);

  // Content bounds — grow the canvas to contain every positioned icon so the
  // root can scroll when content exceeds the visible viewport.
  const contentBounds = useMemo(() => {
    let maxX = size.w;
    let maxY = size.h;
    for (const icon of icons) {
      const pos = positionFor(icon.name);
      const { w, h } = glyphSize(icon.kind);
      maxX = Math.max(maxX, pos.x + w / 2 + 40);
      maxY = Math.max(maxY, pos.y + h / 2 + 60);
    }
    return { w: maxX, h: maxY };
  }, [icons, positionFor, size]);

  // Body facets — affordances and invariants — rendered in fixed top/bottom rows.
  const affordances = useMemo(() => folder?.affordances ?? [], [folder]);
  const invariants = useMemo(() => folder?.invariants ?? [], [folder]);

  // Arcs between children that co-occur — deduped per pair, with per-arc
  // scope classification. An arc is "sentence" scope if the pair ever shares
  // a sentence; otherwise "paragraph" (only co-occurring across sentences in
  // the same paragraph). Each pair produces at most one arc regardless of
  // how many sentences it appears in — duplicate lines don't blend.
  const arcs: Array<{ a: string; b: string; scope: "sentence" | "paragraph"; sentences: string[]; sentence: string }> = useMemo(() => {
    if (!folder) return [];
    const childNames = folder.children.map((c) => c.name);
    const text = folder.language ?? "";
    const sentenceArcs = extractArcs(text, childNames, "sentence");

    const pairMap = new Map<string, { a: string; b: string; scope: "sentence" | "paragraph"; sentences: string[] }>();
    const keyOf = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

    for (const arc of sentenceArcs) {
      const key = keyOf(arc.a, arc.b);
      const existing = pairMap.get(key) ?? { a: arc.a, b: arc.b, scope: "sentence" as const, sentences: [] };
      existing.sentences.push(arc.sentence);
      existing.scope = "sentence";
      pairMap.set(key, existing);
    }

    if (arcScope === "paragraph") {
      const paragraphArcs = extractArcs(text, childNames, "paragraph");
      for (const arc of paragraphArcs) {
        const key = keyOf(arc.a, arc.b);
        if (pairMap.has(key)) continue; // already covered at tighter sentence scope
        pairMap.set(key, { a: arc.a, b: arc.b, scope: "paragraph", sentences: [arc.sentence] });
      }
    }

    return Array.from(pairMap.values()).map((p) => ({
      ...p,
      sentence: p.sentences.length === 1
        ? p.sentences[0]
        : `${p.sentences.length} sentences: ${p.sentences.join(" ⧫ ")}`,
    }));
  }, [folder, arcScope]);

  // Resolve an arc endpoint to its on-canvas position by looking up the icon's
  // position. If either end isn't placed on the current desktop, skip the arc.
  const arcEndpoints = useMemo(() => {
    const byName = new Map<string, { x: number; y: number }>();
    icons.forEach((icon) => {
      const pos = positionFor(icon.name);
      byName.set(icon.name, pos);
    });
    return arcs
      .map((arc) => {
        const pa = byName.get(arc.a);
        const pb = byName.get(arc.b);
        if (!pa || !pb) return null;
        // Center to center. Glyph fill occludes the interior.
        return { arc, pa, pb };
      })
      .filter((x): x is { arc: typeof arcs[number]; pa: { x: number; y: number }; pb: { x: number; y: number } } => x !== null);
  }, [arcs, icons, positionFor]);

  const onIconPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, icon: IconSpec) => {
    if (!folder || !layout) return;
    // Drag begins — contract the peek so it doesn't block the drag and
    // doesn't keep reappearing as we move over other icons.
    isDraggingRef.current = true;
    setHoveredIcon(null);
    if (hoverLeaveTimer.current) { clearTimeout(hoverLeaveTimer.current); hoverLeaveTimer.current = null; }
    if (hoverEnterTimer.current) { clearTimeout(hoverEnterTimer.current); hoverEnterTimer.current = null; }

    // If the pressed icon is already part of a cluster, the cluster travels
    // together. Otherwise just this icon moves; selection resets to it on
    // release so a later click on empty canvas reads as "dissolve".
    const pressedInSelection = selected.has(icon.name) && selected.size > 0;
    const dragGroup: string[] = pressedInSelection ? Array.from(selected) : [icon.name];
    const starts = new Map<string, IconPosition>();
    for (const name of dragGroup) starts.set(name, positionFor(name));
    const anchor = starts.get(icon.name) ?? positionFor(icon.name);

    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const offsetX = e.clientX - anchor.x;
    const offsetY = e.clientY - anchor.y;
    const DRAG_THRESHOLD = 3;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startClientX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startClientY) < DRAG_THRESHOLD) return;
        moved = true;
        if (!pressedInSelection) setSelected(new Set([icon.name]));
      }
      const targetX = ev.clientX - offsetX;
      const targetY = ev.clientY - offsetY;
      const dx = targetX - anchor.x;
      const dy = targetY - anchor.y;
      setLayout((prev) => {
        if (!prev) return prev;
        const nextIcons = { ...prev.icons };
        for (const name of dragGroup) {
          const s = starts.get(name);
          if (!s) continue;
          nextIcons[name] = { x: s.x + dx, y: s.y + dy };
        }
        const next: SpatialLayout = { ...prev, icons: nextIcons };
        queueSave(folder, next);
        return next;
      });
    };
    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      isDraggingRef.current = false;
      // Plain click (no motion): the cluster dissolves to just this icon.
      // A following click on empty canvas will clear it entirely.
      if (!moved) setSelected(new Set([icon.name]));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [folder, layout, positionFor, queueSave, selected]);

  // Rubber-band selection on empty canvas. Press on the canvas itself —
  // no icon or arc intercepts — starts a sweep. Icons whose positions fall
  // inside the rectangle join the cluster as the sweep grows. Shift or
  // meta extends the prior cluster rather than replacing it. A plain click
  // (no motion) on empty canvas clears the cluster.
  const onCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Block the browser's native drag-to-select-text. Without this, sweeping
    // the rubber band across labels highlights their DOM text in blue.
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const extend = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = extend ? new Set(selected) : new Set<string>();

    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setMarquee({ x0: startX, y0: startY, x1: startX, y1: startY });
    isDraggingRef.current = true;
    let moved = false;
    const DRAG_THRESHOLD = 3;

    const onMove = (ev: PointerEvent) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      if (!moved) {
        if (Math.abs(cx - startX) < DRAG_THRESHOLD && Math.abs(cy - startY) < DRAG_THRESHOLD) return;
        moved = true;
      }
      setMarquee({ x0: startX, y0: startY, x1: cx, y1: cy });
      const bx0 = Math.min(startX, cx), by0 = Math.min(startY, cy);
      const bx1 = Math.max(startX, cx), by1 = Math.max(startY, cy);
      const next = new Set(base);
      for (const spec of icons) {
        if (spec.kind === "affordance" || spec.kind === "invariant") continue;
        const p = positionFor(spec.name);
        if (p.x >= bx0 && p.x <= bx1 && p.y >= by0 && p.y <= by1) next.add(spec.name);
      }
      setSelected(next);
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      isDraggingRef.current = false;
      // Plain click on empty canvas (no motion) dissolves the cluster.
      if (!moved && !extend) setSelected(new Set());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [icons, positionFor, selected]);

  const onIconDoubleClick = useCallback((icon: IconSpec) => {
    if (icon.kind === "narrative") {
      const next = !scrollOpen;
      setScrollOpen(next);
      if (!folder) return;
      // Persist the open/closed state per-sigil so each sigil remembers
      // whether its scroll was open the last time I was here.
      setLayout((prev) => {
        const base = prev ?? { version: 1 as const, icons: {} };
        const prevScroll = base.scroll;
        const mergedScroll = prevScroll
          ? { ...prevScroll, open: next }
          : {
              x: SCROLL_DEFAULT_X,
              y: SCROLL_DEFAULT_Y,
              w: SCROLL_DEFAULT_W,
              h: SCROLL_DEFAULT_H,
              open: next,
            };
        const merged: SpatialLayout = { ...base, scroll: mergedScroll };
        queueSave(folder, merged);
        return merged;
      });
      return;
    }
    if (icon.navigateTo) navigate(icon.navigateTo);
  }, [navigate, folder, queueSave, scrollOpen]);

  const cancelHoverLeave = useCallback(() => {
    if (hoverLeaveTimer.current) { clearTimeout(hoverLeaveTimer.current); hoverLeaveTimer.current = null; }
  }, []);

  const cancelHoverEnter = useCallback(() => {
    if (hoverEnterTimer.current) { clearTimeout(hoverEnterTimer.current); hoverEnterTimer.current = null; }
  }, []);

  const scheduleHoverLeave = useCallback(() => {
    cancelHoverLeave();
    cancelHoverEnter();
    hoverLeaveTimer.current = setTimeout(() => setHoveredIcon(null), 60);
  }, [cancelHoverLeave, cancelHoverEnter]);

  // Peek appears only when attention actually rests on an icon. A casual
  // fly-through never pauses long enough to pop anything; a brief, deliberate
  // hover does. 260ms reads as intent without feeling laggy.
  const HOVER_DELAY_MS = 260;

  const onIconPointerEnter = useCallback((e: React.PointerEvent<HTMLDivElement>, icon: IconSpec) => {
    if (isDraggingRef.current) return; // suppress peek during a drag
    if (!icon.peek) return;
    if (!icon.peek.thesis && icon.peek.affordances.length === 0 && icon.peek.invariants.length === 0) return;
    cancelHoverLeave();
    cancelHoverEnter();
    const target = e.currentTarget;
    hoverEnterTimer.current = setTimeout(() => {
      hoverEnterTimer.current = null;
      if (isDraggingRef.current) return;
      const rect = target.getBoundingClientRect();
      setHoveredIcon({ icon, rect });
    }, HOVER_DELAY_MS);
  }, [cancelHoverLeave, cancelHoverEnter]);

  if (mode === "outside" || mode === "through") {
    return (
      <div className={styles.root}>
        <div className={styles.modeBar}>
          <button className={styles.modeBtn} onClick={() => setMode("inside")}>Inside</button>
          <button
            className={`${styles.modeBtn} ${mode === "outside" ? styles.active : ""}`}
            onClick={() => setMode("outside")}
          >Outside</button>
          {renderThrough && (
            <button
              className={`${styles.modeBtn} ${mode === "through" ? styles.active : ""}`}
              onClick={() => setMode("through")}
            >Through</button>
          )}
        </div>
        {mode === "outside"
          ? (folder && (
              <Suspense fallback={<div className={styles.emptyHint}>Loading 3D…</div>}>
                <StructuralView3D
                  folder={folder}
                  currentPath={currentPath}
                  rootName={rootName}
                  mainRoot={mainRoot}
                  importedRoot={importedRoot}
                  navigate={navigate}
                  dark={dark}
                />
              </Suspense>
            ))
          : renderThrough?.()}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {ascend && (
        <div
          className={styles.upButton}
          role="button"
          tabIndex={0}
          onClick={() => navigate(ascend.path)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(ascend.path); }}
        >
          <UpGlyph />
          <span className={styles.upTooltip}>{ascend.name}</span>
        </div>
      )}
      <div className={styles.modeBar}>
        <button
          className={`${styles.modeBtn} ${styles.active}`}
          onClick={() => setMode("inside")}
        >Inside</button>
        <button
          className={styles.modeBtn}
          onClick={() => setMode("outside")}
          title="Structural view — sigil as a sphere with an opening"
        >Outside</button>
        {renderThrough && (
          <button
            className={styles.modeBtn}
            onClick={() => setMode("through")}
            title="POV — attention walking the reach of affordances"
          >Through</button>
        )}
      </div>
      <div className={styles.arcScopeBar}>
        <button
          className={`${styles.arcScopeBtn} ${arcScope === "sentence" ? styles.active : ""}`}
          onClick={() => setArcScope("sentence")}
        >Sentence</button>
        <button
          className={`${styles.arcScopeBtn} ${arcScope === "paragraph" ? styles.active : ""}`}
          onClick={() => setArcScope("paragraph")}
        >Paragraph</button>
      </div>
      {folder && layout && layoutPath === folderKey && (
        <LanguageScrollPanel
          key={folderKey}
          open={scrollOpen}
          onClose={() => {
            setScrollOpen(false);
            if (!folder) return;
            setLayout((prev) => {
              const base = prev ?? { version: 1 as const, icons: {} };
              const prevScroll = base.scroll;
              if (!prevScroll) return base;
              const merged: SpatialLayout = { ...base, scroll: { ...prevScroll, open: false } };
              queueSave(folder, merged);
              return merged;
            });
          }}
          title={folder.name}
          text={stripFrontmatter(folder.language ?? "")}
          initial={layout.scroll}
          onCommit={(next) => {
            setLayout((prev) => {
              const base = prev ?? { version: 1 as const, icons: {} };
              // Preserve the current open state when persisting position/size.
              const merged: SpatialLayout = {
                ...base,
                scroll: { ...next, open: base.scroll?.open ?? true },
              };
              queueSave(folder, merged);
              return merged;
            });
          }}
        />
      )}
      <div className={styles.affordanceRow} aria-label="Affordances">
        {affordances.map((aff) => (
          <div
            key={`aff:${aff.name}`}
            className={styles.rowItem}
            onPointerEnter={(e) => setRowTip({ text: `#${aff.name}`, rect: e.currentTarget.getBoundingClientRect() })}
            onPointerLeave={() => setRowTip(null)}
          >
            <div className={`${styles.glyph} ${styles.affordance}`}>
              <AffordanceGlyph />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.invariantRow} aria-label="Invariants">
        {invariants.map((inv) => (
          <div
            key={`inv:${inv.name}`}
            className={styles.rowItem}
            onPointerEnter={(e) => setRowTip({ text: `!${inv.name}`, rect: e.currentTarget.getBoundingClientRect() })}
            onPointerLeave={() => setRowTip(null)}
          >
            <div className={`${styles.glyph} ${styles.invariant}`}>
              <InvariantGlyph />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.scrollArea}>
      <div
        ref={canvasRef}
        className={styles.canvas}
        style={{ minWidth: contentBounds.w, minHeight: contentBounds.h }}
        onPointerDown={onCanvasPointerDown}
      >
        <div className={styles.parentBar} />
        {marquee && (
          <div
            className={styles.marquee}
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {arcEndpoints.length > 0 && (
          <svg className={styles.arcs} width={contentBounds.w} height={contentBounds.h}>
            {arcEndpoints.map(({ arc, pa, pb }, i) => {
              const midX = (pa.x + pb.x) / 2;
              const midY = (pa.y + pb.y) / 2;
              // Straight lines — natural, honest, no forced bending.
              const d = `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`;
              const title = arc.sentence;
              return (
                <g key={`${arc.a}-${arc.b}-${i}`} className={styles.arcGroup}>
                  <path className={styles.arcHitbox} d={d}><title>{title}</title></path>
                  <path className={`${styles.arcPath} ${arc.scope === "paragraph" ? styles.paragraph : ""}`} d={d}><title>{title}</title></path>
                  <text className={styles.arcLabel} x={midX} y={midY} textAnchor="middle" dominantBaseline="middle">
                    {arcLabel(arc.sentence, 32)}
                    <title>{title}</title>
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {icons.length === 0 && <div className={styles.emptyHint}>Empty sigil. Navigate into one with children.</div>}
        {icons.map((icon) => {
          const pos = positionFor(icon.name);
          const { w, h } = glyphSize(icon.kind);
          const isHovered = hoveredIcon?.icon.name === icon.name && hoveredIcon?.icon.kind === icon.kind;
          const isSelected = selected.has(icon.name);
          return (
            <div
              key={`${icon.kind}:${icon.name}`}
              className={`${styles.icon} ${isHovered ? styles.hovered : ""} ${isSelected ? styles.selected : ""}`}
              style={{ left: pos.x - w / 2, top: pos.y - h / 2 }}
              onPointerDown={(e) => onIconPointerDown(e, icon)}
              onDoubleClick={() => onIconDoubleClick(icon)}
              onPointerEnter={(e) => onIconPointerEnter(e, icon)}
              onPointerLeave={scheduleHoverLeave}
            >
              <div
                className={`${styles.glyph} ${styles[icon.kind]}`}
                style={{ width: w, height: h }}
              >
                {icon.kind === "god" ? <GodGlyph /> :
                 icon.kind === "narrative" ? <span>abc</span> :
                 icon.kind === "landmark" ? <LandmarkGlyph /> :
                 null}
              </div>
              <div className={styles.label}>{icon.name}</div>
            </div>
          );
        })}
      </div>
      </div>
      {hoveredIcon && <FloatingPeek
        icon={hoveredIcon.icon}
        rect={hoveredIcon.rect}
        onPeekEnter={cancelHoverLeave}
        onPeekLeave={scheduleHoverLeave}
      />}
      {rowTip && <RowTooltip text={rowTip.text} rect={rowTip.rect} />}
    </div>
  );
}

/**
 * Portal-rendered tooltip for affordance/invariant row items. Lives at
 * document.body so no panel's overflow clip can swallow it, fixed-positioned
 * in viewport coords above the glyph, with horizontal clamp to the viewport.
 */
function RowTooltip({ text, rect }: { text: string; rect: DOMRect }) {
  const VIEWPORT_MARGIN = 8;
  const GAP = 6;
  const centerX = rect.left + rect.width / 2;
  const vw = window.innerWidth;

  let left = centerX;
  // Clamp so the translated (-50%) tooltip stays inside the viewport.
  // Estimate width by the text length; the tooltip shrinks to fit, so this
  // is a soft upper bound used only to decide when to flip alignment.
  const estWidth = Math.min(240, Math.max(48, text.length * 7 + 16));
  const half = estWidth / 2;
  let transform = "translate(-50%, -100%)";
  if (left - half < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
    transform = "translateY(-100%)";
  } else if (left + half > vw - VIEWPORT_MARGIN) {
    left = vw - VIEWPORT_MARGIN;
    transform = "translate(-100%, -100%)";
  }

  const top = rect.top - GAP;

  return createPortal(
    <div className={styles.rowTooltip} style={{ left, top, transform }}>
      {text}
    </div>,
    document.body,
  );
}

interface FloatingPeekProps {
  icon: IconSpec;
  rect: DOMRect;
  onPeekEnter: () => void;
  onPeekLeave: () => void;
}

/**
 * Portal-rendered peek, positioned in viewport coordinates so it escapes the
 * canvas/scrollArea clipping and flips vertically or horizontally to stay
 * on-screen. Pointer-events auto so the cursor can rest on it without the
 * hover state collapsing.
 */
function FloatingPeek({ icon, rect, onPeekEnter, onPeekLeave }: FloatingPeekProps) {
  if (!icon.peek) return null;
  const peek = icon.peek;
  if (!peek.thesis && peek.affordances.length === 0 && peek.invariants.length === 0) return null;

  const PEEK_WIDTH = 300;
  const VIEWPORT_MARGIN = 12;
  const GAP = 8;

  const centerX = rect.left + rect.width / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: try centered; flip to left-anchor or right-anchor if it'd clip.
  let left = centerX - PEEK_WIDTH / 2;
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  else if (left + PEEK_WIDTH > vw - VIEWPORT_MARGIN) left = vw - VIEWPORT_MARGIN - PEEK_WIDTH;

  // Vertical: below by default; flip above if not enough room below.
  const spaceBelow = vh - rect.bottom - GAP;
  const belowTop = rect.bottom + GAP;
  const aboveBottom = rect.top - GAP;
  const flipUp = spaceBelow < 200 && aboveBottom > 200;
  const topStyle = flipUp
    ? { bottom: vh - aboveBottom, top: "auto" as const }
    : { top: belowTop, bottom: "auto" as const };

  // Narrative peek is just the text — the icon IS the sigil's language,
  // and the sigil's own affordances/invariants already live in their rows.
  const showFacets = icon.kind !== "narrative";

  return createPortal(
    <div
      className={styles.peek}
      style={{ left, width: PEEK_WIDTH, ...topStyle }}
      onPointerEnter={onPeekEnter}
      onPointerLeave={onPeekLeave}
    >
      <div className={styles.peekTitle}>{icon.name}</div>
      {peek.thesis && <div className={styles.peekThesis}>{peek.thesis}</div>}
      {showFacets && peek.affordances.length > 0 && (
        <div className={styles.peekSection}>
          {peek.affordances.map((a) => (
            <span key={`aff:${a}`} className={`${styles.peekChip} ${styles.peekChipAff}`}>#{a}</span>
          ))}
        </div>
      )}
      {showFacets && peek.invariants.length > 0 && (
        <div className={styles.peekSection}>
          {peek.invariants.map((i) => (
            <span key={`inv:${i}`} className={`${styles.peekChip} ${styles.peekChipInv}`}>!{i}</span>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

/**
 * Design language: thin strokes (1.5px), transparent fills, currentColor,
 * gently rounded corners. Each glyph shaped by what it affords or constrains.
 */

/**
 * Build a path for a polygon whose vertices are rounded by radius `r`. Each
 * corner uses a quadratic curve with the original vertex as the control
 * point — a quick, visually clean rounded polygon.
 */
function roundedPolygonPath(points: [number, number][], r: number): string {
  const n = points.length;
  const pieces: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const vax = prev[0] - curr[0], vay = prev[1] - curr[1];
    const vbx = next[0] - curr[0], vby = next[1] - curr[1];
    const la = Math.hypot(vax, vay) || 1;
    const lb = Math.hypot(vbx, vby) || 1;
    const entry: [number, number] = [curr[0] + (vax / la) * r, curr[1] + (vay / la) * r];
    const exit: [number, number] = [curr[0] + (vbx / lb) * r, curr[1] + (vby / lb) * r];
    pieces.push(`${i === 0 ? "M" : "L"} ${entry[0].toFixed(2)} ${entry[1].toFixed(2)}`);
    pieces.push(`Q ${curr[0]} ${curr[1]} ${exit[0].toFixed(2)} ${exit[1].toFixed(2)}`);
  }
  pieces.push("Z");
  return pieces.join(" ");
}

/** Affordance — # in a thin rounded square, the offering tag. */
function AffordanceGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x={2} y={2} width={16} height={16} rx={4} ry={4} strokeWidth={1} />
      <text x={10} y={14.5} textAnchor="middle" fontSize={13} fontWeight={500} fill="currentColor" stroke="none" fontFamily="'SF Mono', 'Fira Code', monospace">#</text>
    </svg>
  );
}

/** Invariant — ! in a thin sharp-cornered square, sealed. */
function InvariantGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x={2} y={2} width={16} height={16} strokeWidth={1} />
      <text x={10} y={14.5} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor" stroke="none" fontFamily="'SF Mono', 'Fira Code', monospace">!</text>
    </svg>
  );
}

/** Landmark — a diamond. A named sigil I can see elsewhere in the
 * territory: not a sibling, not a child, not a god, but a real place on
 * the map that I happen to be pointing at from here. */
function LandmarkGlyph() {
  const path = roundedPolygonPath([[24, 4], [44, 24], [24, 44], [4, 24]], 4);
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path d={path} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** Emergent god — equilateral triangle pointing down, vortex pulling
 * worshippers. Corners gently rounded. */
function GodGlyph() {
  const path = roundedPolygonPath([[6, 6], [90, 6], [48, 80]], 5);
  return (
    <svg viewBox="0 0 96 83" aria-hidden>
      <path d={path} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** UP button — small triangle pointing up with "UP" inside, positioned before
 * the affordance row. Click ascends to the containing sigil. Diffused warm
 * light behind it on hover; tooltip carries the parent's name. */
function UpGlyph() {
  const path = roundedPolygonPath([[20, 3], [37, 30], [3, 30]], 3);
  return (
    <svg viewBox="0 0 40 34" aria-hidden>
      <path d={path} strokeWidth={1.3} strokeLinejoin="round" />
      <text
        x={20}
        y={26}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="currentColor"
        stroke="none"
        fontFamily="var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)"
      >
        UP
      </text>
    </svg>
  );
}

interface LanguageScrollPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  initial?: ScrollPanelLayout;
  onCommit: (layout: ScrollPanelLayout) => void;
}

const SCROLL_MIN_W = 260;
const SCROLL_MIN_H = 180;
const SCROLL_MAX_W_FRAC = 0.92;
const SCROLL_MAX_H_OFFSET = 80;
const SCROLL_DEFAULT_W = 420;
const SCROLL_DEFAULT_H = 520;
const SCROLL_DEFAULT_X = 16;
const SCROLL_DEFAULT_Y = 64;

interface ScrollSize { w: number; h: number }
interface ScrollPos { x: number; y: number }

/**
 * Foldable scroll showing the current sigil's language.md. Size and position
 * persist per-sigil in spatial.layout.json — each sigil remembers how its
 * scroll was arranged. Remounted (via key) when the inhabited sigil changes.
 */
function LanguageScrollPanel({ open, onClose, title, text, initial, onCommit }: LanguageScrollPanelProps) {
  const rendered = useMemo(() => renderWithColoredRefs(text), [text]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ScrollSize>(() => ({
    w: Math.max(SCROLL_MIN_W, initial?.w ?? SCROLL_DEFAULT_W),
    h: Math.max(SCROLL_MIN_H, initial?.h ?? SCROLL_DEFAULT_H),
  }));
  const [pos, setPos] = useState<ScrollPos>(() => ({
    x: initial?.x ?? SCROLL_DEFAULT_X,
    y: initial?.y ?? SCROLL_DEFAULT_Y,
  }));
  const [resizing, setResizing] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);

  const commit = useCallback((nextSize: ScrollSize, nextPos: ScrollPos) => {
    onCommit({
      x: Math.round(nextPos.x),
      y: Math.round(nextPos.y),
      w: Math.round(nextSize.w),
      h: Math.round(nextSize.h),
    });
  }, [onCommit]);

  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const left = rect.left;
    const top = rect.top;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const maxW = window.innerWidth * SCROLL_MAX_W_FRAC;
      const maxH = window.innerHeight - top - SCROLL_MAX_H_OFFSET;
      const w = Math.min(maxW, Math.max(SCROLL_MIN_W, ev.clientX - left));
      const h = Math.min(maxH, Math.max(SCROLL_MIN_H, ev.clientY - top));
      setSize({ w, h });
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      setSize((s) => { commit(s, pos); return s; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [commit, pos]);

  const onHeaderDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Don't start drag when the click is on the close button.
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.scrollClose}`)) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = pos;
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const nx = startPos.x + (ev.clientX - startX);
      const ny = startPos.y + (ev.clientY - startY);
      // Keep at least the header inside the viewport on any side.
      const margin = 24;
      const clampedX = Math.max(margin - size.w + 80, Math.min(window.innerWidth - margin, nx));
      const clampedY = Math.max(0, Math.min(window.innerHeight - margin, ny));
      setPos({ x: clampedX, y: clampedY });
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      setPos((p) => { commit(size, p); return p; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [commit, pos, size]);

  const activeTransition = resizing || dragging;

  return (
    <div
      ref={panelRef}
      className={`${styles.scrollPanel} ${open ? "" : styles.closed}`}
      style={{
        width: size.w,
        height: size.h,
        left: pos.x,
        top: pos.y,
        transition: activeTransition ? "none" : undefined,
      }}
    >
      <div
        className={`${styles.scrollHeader} ${dragging ? styles.dragging : ""}`}
        onPointerDown={onHeaderDown}
      >
        <span>{title ? `${title}/language.md` : "language.md"}</span>
        <button className={styles.scrollClose} onClick={onClose} aria-label="Close scroll">×</button>
      </div>
      <div className={styles.scrollBody}>{rendered}</div>
      <div
        className={`${styles.scrollResizeHandle} ${resizing ? styles.active : ""}`}
        onPointerDown={onResizeDown}
        aria-label="Resize scroll panel"
        role="separator"
      />
    </div>
  );
}

/**
 * Tokenize the text, wrapping each `@ref` in a plain span so it can be
 * styled neutrally. No color, no highlighting — refs are recognizable
 * from their `@` prefix alone.
 */
function renderWithColoredRefs(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /@([A-Za-z][A-Za-z0-9_]*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<span key={start}>{match[0]}</span>);
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
