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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceState, useWorkspaceActions, resolveCurrentFolder } from "../../state/WorkspaceContext";
import { regionPosition, readLayout, writeLayout, type IconPosition, type SpatialLayout, type IconKindForLayout } from "../../lib/spatialLayout";
import { colorForSigilName } from "../../lib/sigilColor";
import { extractArcs, arcLabel, type ArcScope } from "../../lib/sentenceArcs";
import { extractEntanglements } from "../../lib/entanglements";
import type { Sigil } from "sigil-core";
import styles from "./SpatialDesktop.module.css";

type IconKind = "child" | "neighbor" | "god" | "parent" | "narrative" | "affordance" | "invariant";

interface IconSpec {
  name: string;
  kind: IconKind;
  navigateTo?: string[]; // absolute path in the workspace tree — undefined for body-facet icons
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
    case "affordance":
    case "invariant": return { w: UNIT, h: UNIT };                             // 24×24
  }
}

/**
 * Compute how far to project from the glyph's center along direction
 * (ux, uy) so the line ends just inside the icon's visible edge. Since
 * every icon has an opaque fill, any portion of the line inside the
 * glyph is occluded — the line visibly terminates exactly at the border.
 */
function edgeOffset(kind: IconKind, ux: number, uy: number): { ox: number; oy: number } {
  const { w, h } = glyphSize(kind);
  // Child is a circle.
  if (kind === "child") {
    const r = w / 2 - 3;
    return { ox: ux * r, oy: uy * r };
  }
  // Triangles: inscribed radius, no outward margin.
  if (kind === "parent" || kind === "god") {
    const r = h / 3;
    return { ox: ux * r, oy: uy * r };
  }
  // Rectangular kinds: ray-rectangle, tucked a few px inside.
  const axu = Math.abs(ux) || 1e-9;
  const ayu = Math.abs(uy) || 1e-9;
  const t = Math.min((w / 2) / axu, (h / 2) / ayu);
  return { ox: ux * (t - 4), oy: uy * (t - 4) };
}

const SAVE_DEBOUNCE_MS = 400;

export function SpatialDesktop() {
  const ws = useWorkspaceState();
  const { navigate } = useWorkspaceActions();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [layout, setLayout] = useState<SpatialLayout | null>(null);
  const [mode, setMode] = useState<"inside" | "outside">("inside");
  const [scrollOpen, setScrollOpen] = useState<boolean>(false);
  const [arcScope, setArcScope] = useState<ArcScope>("sentence");

  const folder = resolveCurrentFolder(ws);

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

  // Load layout when the inhabited sigil changes.
  useEffect(() => {
    if (!folder) { setLayout(null); return; }
    let cancelled = false;
    readLayout(folder.path).then((l) => { if (!cancelled) setLayout(l); });
    return () => { cancelled = true; };
  }, [folder?.path]);

  // Debounced save: whenever the layout changes, write it out after a pause.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSave = useCallback((path: string, next: SpatialLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeLayout(path, next).catch((err) => console.error("spatial layout save failed:", err));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Ascension target — the containing sigil. Rendered as a separate UP
  // button, not as a canvas icon.
  const ascend = useMemo(() => {
    const currentPath = ws.currentPath;
    if (currentPath.length === 0) return null;
    const parentPath = currentPath.slice(0, -1);
    const parentName = parentPath.length === 0
      ? (ws.currentPath[0] === "Imported Ontologies" ? "Imported Ontologies" : ws.spec.name)
      : parentPath[parentPath.length - 1];
    return { name: parentName, path: parentPath };
  }, [ws.currentPath, ws.spec.name]);

  // Derive the icons for the current sigil. Phase A: narrative + children + entanglements.
  const icons: IconSpec[] = useMemo(() => {
    if (!folder) return [];
    const list: IconSpec[] = [];
    const currentPath = ws.currentPath;
    // My body — narrative (language.md) always present.
    list.push({ name: NARRATIVE_NAME, kind: "narrative" });
    // Affordances and invariants live in their own fixed rows — not in the
    // draggable icon list. See affordances/invariants memoized below.
    for (const child of folder.children) {
      list.push({ name: child.name, kind: "child", navigateTo: [...currentPath, child.name] });
    }
    // Neighbors and gods — entanglements referenced in my language.
    const childNames = folder.children.map((c) => c.name);
    const isImported = ws.currentPath[0] === "Imported Ontologies";
    const root: Sigil = (isImported ? ws.spec.importedOntologies : ws.spec.root) as Sigil;
    const resolvedCurrentPath = isImported ? ws.currentPath.slice(1) : ws.currentPath;
    const entanglements = extractEntanglements(
      folder.language ?? "",
      root,
      resolvedCurrentPath,
      ws.spec.importedOntologies ?? null,
      childNames,
    );
    for (const ent of entanglements) {
      list.push({ name: ent.name, kind: ent.kind, navigateTo: ent.path });
    }
    return list;
  }, [folder, ws.currentPath, ws.spec.name, ws.spec.root, ws.spec.importedOntologies]);

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
    const byName = new Map<string, { x: number; y: number; kind: IconKind }>();
    icons.forEach((icon) => {
      const pos = positionFor(icon.name);
      byName.set(icon.name, { ...pos, kind: icon.kind });
    });
    return arcs
      .map((arc) => {
        const pa = byName.get(arc.a);
        const pb = byName.get(arc.b);
        if (!pa || !pb) return null;
        // Direction from each center to the other — use it to find the point
        // on this icon's actual edge in the direction of the other icon.
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const offA = edgeOffset(pa.kind, ux, uy);
        const offB = edgeOffset(pb.kind, -ux, -uy);
        const paEdge = { x: pa.x + offA.ox, y: pa.y + offA.oy };
        const pbEdge = { x: pb.x + offB.ox, y: pb.y + offB.oy };
        return { arc, pa: paEdge, pb: pbEdge };
      })
      .filter((x): x is { arc: typeof arcs[number]; pa: { x: number; y: number }; pb: { x: number; y: number } } => x !== null);
  }, [arcs, icons, positionFor]);

  const onIconPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, icon: IconSpec) => {
    if (!folder || !layout) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = positionFor(icon.name);
    const offsetX = e.clientX - start.x;
    const offsetY = e.clientY - start.y;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - offsetX;
      const y = ev.clientY - offsetY;
      moved = true;
      setLayout((prev) => {
        if (!prev) return prev;
        const next: SpatialLayout = { ...prev, icons: { ...prev.icons, [icon.name]: { x, y } } };
        queueSave(folder.path, next);
        return next;
      });
    };
    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // A tiny click without movement still counts as a drag event; no-op.
      if (!moved) { /* click semantics live in onDoubleClick */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [folder, layout, positionFor, queueSave]);

  const onIconDoubleClick = useCallback((icon: IconSpec) => {
    if (icon.kind === "narrative") {
      setScrollOpen((v) => !v);
      return;
    }
    if (icon.navigateTo) navigate(icon.navigateTo);
  }, [navigate]);

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
          className={`${styles.modeBtn} ${arcScope === "sentence" ? styles.active : ""}`}
          onClick={() => setArcScope(arcScope === "sentence" ? "paragraph" : "sentence")}
          title={`Arc scope: ${arcScope}. Click to toggle.`}
        >{arcScope === "sentence" ? "Sentence" : "Paragraph"}</button>
        <button
          className={`${styles.modeBtn} ${mode === "inside" ? styles.active : ""}`}
          onClick={() => setMode("inside")}
        >Inside</button>
        <button
          className={`${styles.modeBtn} ${mode === "outside" ? styles.active : ""}`}
          onClick={() => setMode("outside")}
          disabled
          title="3D atlas — Phase B"
        >Outside</button>
      </div>
      <LanguageScrollPanel
        open={scrollOpen}
        onClose={() => setScrollOpen(false)}
        title={folder ? folder.name : ""}
        text={folder?.language ?? ""}
        childNames={folder ? folder.children.map((c) => c.name) : []}
      />
      <div className={styles.affordanceRow} aria-label="Affordances">
        {affordances.map((aff) => (
          <div key={`aff:${aff.name}`} className={styles.rowItem}>
            <div className={`${styles.glyph} ${styles.affordance}`}>
              <AffordanceGlyph />
            </div>
            <div className={styles.rowLabel}>#{aff.name}</div>
          </div>
        ))}
      </div>
      <div className={styles.invariantRow} aria-label="Invariants">
        {invariants.map((inv) => (
          <div key={`inv:${inv.name}`} className={styles.rowItem}>
            <div className={`${styles.glyph} ${styles.invariant}`}>
              <InvariantGlyph />
            </div>
            <div className={styles.rowLabel}>!{inv.name}</div>
          </div>
        ))}
      </div>
      <div className={styles.scrollArea}>
      <div
        ref={canvasRef}
        className={styles.canvas}
        style={{ minWidth: contentBounds.w, minHeight: contentBounds.h }}
      >
        <div className={styles.parentBar} />
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
          return (
            <div
              key={`${icon.kind}:${icon.name}`}
              className={styles.icon}
              style={{ left: pos.x - w / 2, top: pos.y - h / 2 }}
              onPointerDown={(e) => onIconPointerDown(e, icon)}
              onDoubleClick={() => onIconDoubleClick(icon)}
            >
              <div
                className={`${styles.glyph} ${styles[icon.kind]}`}
                style={{ width: w, height: h }}
              >
                {icon.kind === "god" ? <GodGlyph /> :
                 icon.kind === "narrative" ? <span>abc</span> :
                 icon.kind === "neighbor" ? null :
                 initials(icon.name)}
              </div>
              <div className={styles.label}>{icon.name}</div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  childNames: string[];
}

const SCROLL_SIZE_STORAGE_KEY = "sigil.spatial.scrollSize";
const SCROLL_MIN_W = 260;
const SCROLL_MIN_H = 180;
const SCROLL_MAX_W_FRAC = 0.92;
const SCROLL_MAX_H_OFFSET = 80;
const SCROLL_DEFAULT_W = 420;
const SCROLL_DEFAULT_H = 520;

interface ScrollSize { w: number; h: number }

function loadScrollSize(): ScrollSize {
  try {
    const raw = localStorage.getItem(SCROLL_SIZE_STORAGE_KEY);
    if (!raw) return { w: SCROLL_DEFAULT_W, h: SCROLL_DEFAULT_H };
    const parsed = JSON.parse(raw) as Partial<ScrollSize>;
    const w = Number.isFinite(parsed.w) ? (parsed.w as number) : SCROLL_DEFAULT_W;
    const h = Number.isFinite(parsed.h) ? (parsed.h as number) : SCROLL_DEFAULT_H;
    return { w: Math.max(SCROLL_MIN_W, w), h: Math.max(SCROLL_MIN_H, h) };
  } catch {
    return { w: SCROLL_DEFAULT_W, h: SCROLL_DEFAULT_H };
  }
}

function saveScrollSize(size: ScrollSize): void {
  try { localStorage.setItem(SCROLL_SIZE_STORAGE_KEY, JSON.stringify({ w: Math.round(size.w), h: Math.round(size.h) })); } catch { /* ignore */ }
}

const SCROLL_POS_STORAGE_KEY = "sigil.spatial.scrollPos";

interface ScrollPos { x: number; y: number }

function loadScrollPos(): ScrollPos {
  try {
    const raw = localStorage.getItem(SCROLL_POS_STORAGE_KEY);
    if (!raw) return { x: 16, y: 64 };
    const parsed = JSON.parse(raw) as Partial<ScrollPos>;
    const x = Number.isFinite(parsed.x) ? (parsed.x as number) : 16;
    const y = Number.isFinite(parsed.y) ? (parsed.y as number) : 64;
    return { x, y };
  } catch {
    return { x: 16, y: 64 };
  }
}

function saveScrollPos(pos: ScrollPos): void {
  try { localStorage.setItem(SCROLL_POS_STORAGE_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })); } catch { /* ignore */ }
}

/**
 * Foldable scroll showing the current sigil's language.md with @-refs that
 * resolve to a child rendered in the child's own color. The right edge is
 * a drag handle for width; width persists to localStorage.
 */
function LanguageScrollPanel({ open, onClose, title, text, childNames }: LanguageScrollPanelProps) {
  const childSet = useMemo(() => new Set(childNames), [childNames]);
  const rendered = useMemo(() => renderWithColoredRefs(text, childSet), [text, childSet]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ScrollSize>(() => loadScrollSize());
  const [pos, setPos] = useState<ScrollPos>(() => loadScrollPos());
  const [resizing, setResizing] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);

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
      setSize((s) => { saveScrollSize(s); return s; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

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
      setPos((p) => { saveScrollPos(p); return p; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pos, size]);

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
 * Tokenize the text and wrap any `@Name` that resolves to a named child
 * in a span colored with that child's deterministic hue. Everything else
 * is passed through as text.
 */
function renderWithColoredRefs(text: string, childSet: Set<string>): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /@([A-Za-z][A-Za-z0-9_]*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > last) parts.push(text.slice(last, start));
    const name = match[1];
    if (childSet.has(name)) {
      parts.push(
        <span key={start} className={styles.ref} style={{ color: colorForSigilName(name) }}>{match[0]}</span>
      );
    } else {
      parts.push(<span key={start}>{match[0]}</span>);
    }
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
