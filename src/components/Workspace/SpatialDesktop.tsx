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
import { extractArcs, arcLabel, type SentenceArc, type ArcScope } from "../../lib/sentenceArcs";
import { extractEntanglements } from "../../lib/entanglements";
import type { Sigil } from "sigil-core";
import styles from "./SpatialDesktop.module.css";

type IconKind = "child" | "neighbor" | "god" | "parent" | "narrative" | "affordance" | "invariant";

interface IconSpec {
  name: string;
  kind: IconKind;
  navigateTo?: string[]; // absolute path in the workspace tree — undefined for body-facet icons
}

const NARRATIVE_NAME = "narrative";

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
    case "parent":    return { w: UNIT * 6, h: Math.round(UNIT * 6 * 0.866) }; // equilateral 144×125
    case "god":       return { w: UNIT * 4, h: Math.round(UNIT * 4 * 0.866) }; // equilateral 96×83
    case "neighbor":  return { w: UNIT * 3, h: UNIT * 4 };                     // door 72×96
    case "child":     return { w: UNIT * 3, h: UNIT * 3 };                     // 72×72
    case "narrative": return { w: UNIT * 2, h: Math.round(UNIT * 2.5) };       // 48×60
    case "affordance":
    case "invariant": return { w: UNIT, h: UNIT };                             // 24×24
  }
}

/** Outer radius used to trim arc endpoints so they meet the icon's edge. */
function glyphRadius(kind: IconKind): number {
  const { w, h } = glyphSize(kind);
  return Math.max(w, h) / 2;
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

  // Derive the icons for the current sigil. Phase A: parent + narrative + children.
  const icons: IconSpec[] = useMemo(() => {
    if (!folder) return [];
    const list: IconSpec[] = [];
    const currentPath = ws.currentPath;
    // Structural parent — only when not at root.
    if (currentPath.length > 0) {
      const parentPath = currentPath.slice(0, -1);
      const parentName = parentPath.length === 0
        ? (ws.currentPath[0] === "Imported Ontologies" ? "Imported Ontologies" : ws.spec.name)
        : parentPath[parentPath.length - 1];
      list.push({ name: parentName, kind: "parent", navigateTo: parentPath });
    }
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
      if (icon.kind === "parent" || icon.kind === "affordance" || icon.kind === "invariant") continue;
      const n = counters[icon.kind] ?? 0;
      byName.set(icon.name, { kind: icon.kind, index: n });
      counters[icon.kind] = n + 1;
    }
    return { byName, counters };
  }, [icons]);

  const positionFor = useCallback((name: string): IconPosition => {
    const entry = kindIndex.byName.get(name);
    if (!entry) return { x: size.w / 2, y: size.h / 2 };
    // Only children honor user-dragged positions. Everything else (narrative,
    // gods, neighbors) belongs in its region — stored positions from older
    // runs are ignored so regions stay composed and don't overlap.
    if (entry.kind === "child") {
      const stored = layout?.icons[name];
      if (stored) return stored;
    }
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
      const pos = icon.kind === "parent" ? { x: size.w / 2, y: 32 } : positionFor(icon.name);
      const { w, h } = glyphSize(icon.kind);
      maxX = Math.max(maxX, pos.x + w / 2 + 40);
      maxY = Math.max(maxY, pos.y + h / 2 + 60);
    }
    return { w: maxX, h: maxY };
  }, [icons, positionFor, size]);

  // Body facets — affordances and invariants — rendered in fixed top/bottom rows.
  const affordances = useMemo(() => folder?.affordances ?? [], [folder]);
  const invariants = useMemo(() => folder?.invariants ?? [], [folder]);

  // Arcs between children that co-occur in a sentence (or paragraph) of the sigil's language.
  const arcs: SentenceArc[] = useMemo(() => {
    if (!folder) return [];
    const childNames = folder.children.map((c) => c.name);
    return extractArcs(folder.language ?? "", childNames, arcScope);
  }, [folder, arcScope]);

  // Resolve an arc endpoint to its on-canvas position by looking up the icon's
  // position. If either end isn't placed on the current desktop, skip the arc.
  const arcEndpoints = useMemo(() => {
    const byName = new Map<string, { x: number; y: number; r: number }>();
    icons.forEach((icon) => {
      if (icon.kind === "parent") return;
      const pos = positionFor(icon.name);
      byName.set(icon.name, { ...pos, r: glyphRadius(icon.kind) });
    });
    return arcs
      .map((arc) => {
        const pa = byName.get(arc.a);
        const pb = byName.get(arc.b);
        if (!pa || !pb) return null;
        // Trim each end by the glyph radius so the line meets the icon's edge,
        // not its center — lines look like they converge on the icon cleanly.
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const trimA = Math.min(pa.r, dist * 0.45);
        const trimB = Math.min(pb.r, dist * 0.45);
        const paTrimmed = { x: pa.x + ux * trimA, y: pa.y + uy * trimA };
        const pbTrimmed = { x: pb.x - ux * trimB, y: pb.y - uy * trimB };
        return { arc, pa: paTrimmed, pb: pbTrimmed };
      })
      .filter((x): x is { arc: SentenceArc; pa: { x: number; y: number }; pb: { x: number; y: number } } => x !== null);
  }, [arcs, icons, positionFor]);

  const onIconPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, icon: IconSpec) => {
    if (!folder || !layout) return;
    if (icon.kind === "parent") return; // Parent pinned at top; no drag.
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
      <div
        ref={canvasRef}
        className={styles.canvas}
        style={{ minWidth: contentBounds.w, minHeight: contentBounds.h }}
      >
        <div className={styles.parentBar} />
        {arcEndpoints.length > 0 && (
          <svg className={styles.arcs} width={size.w} height={size.h}>
            {arcEndpoints.map(({ arc, pa, pb }, i) => {
              const midX = (pa.x + pb.x) / 2;
              const midY = (pa.y + pb.y) / 2;
              const dx = pb.x - pa.x;
              const dy = pb.y - pa.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              // Curve control point perpendicular to the segment, curving upward consistently.
              const curveOffset = Math.min(60, dist * 0.25);
              const nx = -dy / dist;
              const ny = dx / dist;
              const cx = midX + nx * curveOffset;
              const cy = midY + ny * curveOffset;
              const d = `M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`;
              const labelX = cx;
              const labelY = cy;
              const title = arc.sentence;
              return (
                <g key={`${arc.a}-${arc.b}-${arc.sentenceIndex}-${i}`} className={styles.arcGroup}>
                  <path className={styles.arcHitbox} d={d}><title>{title}</title></path>
                  <path className={styles.arcPath} d={d}><title>{title}</title></path>
                  <text className={styles.arcLabel} x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle">
                    {arcLabel(arc.sentence, 32)}
                    <title>{title}</title>
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {affordances.length > 0 && (
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
        )}
        {invariants.length > 0 && (
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
        )}
        {icons.length === 0 && <div className={styles.emptyHint}>Empty sigil. Navigate into one with children.</div>}
        {icons.map((icon) => {
          const pos = icon.kind === "parent"
            ? { x: size.w / 2, y: 80 }
            : positionFor(icon.name);
          const { w, h } = glyphSize(icon.kind);
          return (
            <div
              key={`${icon.kind}:${icon.name}`}
              className={styles.icon}
              style={{ left: pos.x - w / 2, top: pos.y - h / 2 }}
              onPointerDown={(e) => onIconPointerDown(e, icon)}
              onDoubleClick={() => onIconDoubleClick(icon)}
              title={`${icon.kind}: ${icon.name}`}
            >
              <div
                className={`${styles.glyph} ${styles[icon.kind]}`}
                style={{ width: w, height: h }}
              >
                {icon.kind === "parent" ? <ParentGlyph name={icon.name} /> :
                 icon.kind === "god" ? <GodGlyph /> :
                 icon.kind === "narrative" ? <span>abc</span> :
                 icon.kind === "neighbor" ? icon.name :
                 initials(icon.name)}
              </div>
              {icon.kind !== "neighbor" && icon.kind !== "parent" && (
                <div className={styles.label}>{icon.kind === "narrative" ? "narrative" : icon.name}</div>
              )}
            </div>
          );
        })}
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
 * Design language: thin strokes (1.5px), transparent fills, currentColor.
 * Each glyph shaped by what it affords or constrains.
 */

/** Affordance — # enclosed in a thin rounded rectangle, the "tag" that offers. */
function AffordanceGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x={1.5} y={1.5} width={17} height={17} rx={5} ry={5} strokeWidth={1.5} />
      <text x={10} y={14.5} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor" stroke="none" fontFamily="'SF Mono', 'Fira Code', monospace">#</text>
    </svg>
  );
}

/** Invariant — ! enclosed in a thin sharp-cornered square, sealed. */
function InvariantGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x={1.5} y={1.5} width={17} height={17} strokeWidth={1.5} />
      <text x={10} y={14.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor" stroke="none" fontFamily="'SF Mono', 'Fira Code', monospace">!</text>
    </svg>
  );
}

/** One true god (structural parent / @LawsOfNature) — equilateral triangle
 * pointing up, name inside auto-shrinks to fit the triangle's lower width. */
function ParentGlyph({ name }: { name: string }) {
  // Equilateral: 144×125. Apex at (72, 6), base at y=119.
  // Inner width at y=98 (74% height) ≈ 108, generous but safe for text.
  return (
    <svg viewBox="0 0 144 125" aria-hidden>
      <polygon points="72,6 138,119 6,119" strokeWidth={1.5} strokeLinejoin="round" />
      <text
        x={72}
        y={102}
        textAnchor="middle"
        fontSize={13}
        fill="currentColor"
        stroke="none"
        fontFamily="var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)"
        textLength={108}
        lengthAdjust="spacingAndGlyphs"
      >
        {name}
      </text>
    </svg>
  );
}

/** Emergent god — equilateral triangle pointing down, vortex pulling worshippers. */
function GodGlyph() {
  return (
    <svg viewBox="0 0 96 83" aria-hidden>
      <polygon points="6,6 90,6 48,80" strokeWidth={1.5} strokeLinejoin="round" />
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
  const [resizing, setResizing] = useState<boolean>(false);

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

  return (
    <div
      ref={panelRef}
      className={`${styles.scrollPanel} ${open ? "" : styles.closed}`}
      style={{ width: size.w, height: size.h, transition: resizing ? "none" : undefined }}
    >
      <div className={styles.scrollHeader}>
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
