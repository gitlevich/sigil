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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceState, useWorkspaceActions, resolveCurrentFolder } from "../../state/WorkspaceContext";
import { defaultPosition, readLayout, writeLayout, type IconPosition, type SpatialLayout } from "../../lib/spatialLayout";
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
      <div ref={canvasRef} className={styles.canvas}>
        <div className={styles.parentBar} />
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
              <div className={`${styles.glyph} ${styles[icon.kind]}`}>
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
