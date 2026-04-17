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
import { defaultPosition, readLayout, writeLayout, type IconPosition, type SpatialLayout } from "../../lib/spatialLayout";
import { colorForSigilName } from "../../lib/sigilColor";
import { extractArcs, arcLabel, type SentenceArc } from "../../lib/sentenceArcs";
import styles from "./SpatialDesktop.module.css";

type IconKind = "child" | "neighbor" | "god" | "parent";

interface IconSpec {
  name: string;
  kind: IconKind;
  navigateTo: string[]; // absolute path in the workspace tree
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

  // Derive the icons for the current sigil. Phase A: parent + children.
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
    for (const child of folder.children) {
      list.push({ name: child.name, kind: "child", navigateTo: [...currentPath, child.name] });
    }
    return list;
  }, [folder, ws.currentPath, ws.spec.name]);

  const positionFor = useCallback((name: string, index: number): IconPosition => {
    const stored = layout?.icons[name];
    if (stored) return stored;
    return defaultPosition(name, index, size.w, size.h);
  }, [layout, size]);

  // Arcs between children that co-occur in a sentence of the sigil's language.
  const arcs: SentenceArc[] = useMemo(() => {
    if (!folder) return [];
    const childNames = folder.children.map((c) => c.name);
    return extractArcs(folder.language ?? "", childNames);
  }, [folder]);

  // Resolve an arc endpoint to its on-canvas position by looking up the icon's
  // position. If either end isn't placed on the current desktop, skip the arc.
  const arcEndpoints = useMemo(() => {
    const byName = new Map<string, { x: number; y: number }>();
    icons.forEach((icon, i) => {
      if (icon.kind === "parent") return;
      const pos = positionFor(icon.name, i);
      byName.set(icon.name, pos);
    });
    return arcs
      .map((arc) => {
        const pa = byName.get(arc.a);
        const pb = byName.get(arc.b);
        if (!pa || !pb) return null;
        return { arc, pa, pb };
      })
      .filter((x): x is { arc: SentenceArc; pa: { x: number; y: number }; pb: { x: number; y: number } } => x !== null);
  }, [arcs, icons, positionFor]);

  const onIconPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, icon: IconSpec, index: number) => {
    if (!folder || !layout) return;
    if (icon.kind === "parent") return; // Parent pinned at top; no drag.
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = positionFor(icon.name, index);
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
    navigate(icon.navigateTo);
  }, [navigate]);

  return (
    <div className={styles.root}>
      <div className={styles.modeBar}>
        <button
          className={`${styles.modeBtn} ${scrollOpen ? styles.active : ""}`}
          onClick={() => setScrollOpen((v) => !v)}
          title="Show this sigil's language with color-signed references"
        >Scroll</button>
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
      <div ref={canvasRef} className={styles.canvas}>
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
                <g key={`${arc.a}-${arc.b}-${arc.sentenceIndex}-${i}`}>
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
        {icons.length === 0 && <div className={styles.emptyHint}>Empty sigil. Navigate into one with children.</div>}
        {icons.map((icon, i) => {
          const pos = icon.kind === "parent"
            ? { x: size.w / 2, y: 28 }
            : positionFor(icon.name, i);
          return (
            <div
              key={`${icon.kind}:${icon.name}`}
              className={styles.icon}
              style={{ left: pos.x - 22, top: pos.y - 22 }}
              onPointerDown={(e) => onIconPointerDown(e, icon, i)}
              onDoubleClick={() => onIconDoubleClick(icon)}
              title={`${icon.kind}: ${icon.name}`}
            >
              <div
                className={`${styles.glyph} ${styles[icon.kind]}`}
                style={icon.kind === "child" ? { background: colorForSigilName(icon.name) } : undefined}
              >
                {icon.kind === "parent" ? "" : initials(icon.name)}
              </div>
              <div className={styles.label}>{icon.name}</div>
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

interface LanguageScrollPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  childNames: string[];
}

/**
 * Foldable scroll showing the current sigil's language.md with @-refs that
 * resolve to a child rendered in the child's own color. This is the same
 * color-signature used for the child's icon on the desktop, so the text and
 * the canvas reinforce each other.
 */
function LanguageScrollPanel({ open, onClose, title, text, childNames }: LanguageScrollPanelProps) {
  const childSet = useMemo(() => new Set(childNames), [childNames]);
  const rendered = useMemo(() => renderWithColoredRefs(text, childSet), [text, childSet]);
  return (
    <div className={`${styles.scrollPanel} ${open ? "" : styles.closed}`}>
      <div className={styles.scrollHeader}>
        <span>{title ? `${title}/language.md` : "language.md"}</span>
        <button className={styles.scrollClose} onClick={onClose} aria-label="Close scroll">×</button>
      </div>
      <div className={styles.scrollBody}>{rendered}</div>
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
