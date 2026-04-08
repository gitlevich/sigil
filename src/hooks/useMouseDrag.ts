import { useRef, useCallback, useEffect, useState } from "react";

/** Threshold in pixels before a mousedown becomes a drag. */
export const DRAG_THRESHOLD = 5;

export interface DragState {
  /** The fsPath being dragged, or null if idle. */
  sourcePath: string | null;
  /** The fsPath currently hovered as drop target, or null. */
  targetPath: string | null;
}

interface DragCallbacks {
  onDrop: (sourcePath: string, targetPath: string) => void;
  /** Return false to reject the drop target. */
  canDrop?: (sourcePath: string, targetPath: string) => boolean;
}

function suppressTextSelection() {
  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";
}

function restoreTextSelection() {
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";
}

/**
 * Standard drag ghost: clones the grabbed element and floats it at the cursor.
 * Direct DOM manipulation — no React re-renders during mousemove.
 */
export function createDragGhost() {
  let ghost: HTMLElement | null = null;
  let offsetX = 0;
  let offsetY = 0;

  return {
    /** Clone sourceEl and position the ghost where the user grabbed it. */
    show(sourceEl: HTMLElement, grabX: number, grabY: number) {
      const rect = sourceEl.getBoundingClientRect();
      offsetX = grabX - rect.left;
      offsetY = grabY - rect.top;

      ghost = sourceEl.cloneNode(true) as HTMLElement;
      ghost.style.position = "fixed";
      ghost.style.pointerEvents = "none";
      ghost.style.zIndex = "200";
      ghost.style.width = `${rect.width}px`;
      ghost.style.opacity = "0.7";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      ghost.style.borderRadius = "3px";
      document.body.appendChild(ghost);
    },
    /** Move ghost so cursor stays at the same relative grab offset. */
    move(x: number, y: number) {
      if (!ghost) return;
      ghost.style.left = `${x - offsetX}px`;
      ghost.style.top = `${y - offsetY}px`;
    },
    hide() {
      if (!ghost) return;
      ghost.remove();
      ghost = null;
    },
  };
}

/**
 * Mouse-based drag-and-drop that bypasses native NSDragging.
 *
 * Tauri's WKWebView subclass (wry) overrides NSDraggingDestination,
 * which on macOS 26+ interferes with HTML5 drag events.
 * This hook uses mousedown/mousemove/mouseup instead.
 *
 * Visual feedback: the grabbed row is cloned as a semi-transparent ghost
 * that follows the cursor. The original row dims via CSS (.dragSource).
 * Valid drop targets highlight via CSS (.dropTarget).
 */
export function useMouseDrag(callbacks: DragCallbacks) {
  const [dragState, setDragState] = useState<DragState>({ sourcePath: null, targetPath: null });
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const pendingSource = useRef<string | null>(null);
  const sourceEl = useRef<HTMLElement | null>(null);
  const dragging = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const ghost = useRef(createDragGhost());

  const onDragStart = useCallback((e: React.MouseEvent, fsPath: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    startPos.current = { x: e.clientX, y: e.clientY };
    pendingSource.current = fsPath;
    sourceEl.current = e.currentTarget as HTMLElement;
    suppressTextSelection();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!pendingSource.current || !startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (!dragging.current && (dx * dx + dy * dy) >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        dragging.current = true;
        window.getSelection()?.removeAllRanges();
        if (sourceEl.current) {
          ghost.current.show(sourceEl.current, startPos.current.x, startPos.current.y);
        }
        setDragState({ sourcePath: pendingSource.current, targetPath: null });
      }
      if (dragging.current) {
        ghost.current.move(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
      restoreTextSelection();
      ghost.current.hide();
      if (dragging.current) {
        setTimeout(() => {
          dragging.current = false;
          pendingSource.current = null;
          sourceEl.current = null;
          startPos.current = null;
          setDragState({ sourcePath: null, targetPath: null });
        }, 0);
      } else {
        pendingSource.current = null;
        sourceEl.current = null;
        startPos.current = null;
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const onTargetEnter = useCallback((fsPath: string) => {
    if (!dragging.current || !pendingSource.current) return;
    const canDrop = callbacksRef.current.canDrop;
    if (canDrop && !canDrop(pendingSource.current, fsPath)) return;
    setDragState(prev => ({ ...prev, targetPath: fsPath }));
  }, []);

  const onTargetLeave = useCallback((fsPath: string) => {
    setDragState(prev => prev.targetPath === fsPath ? { ...prev, targetPath: null } : prev);
  }, []);

  const onTargetDrop = useCallback((fsPath: string) => {
    if (!dragging.current || !pendingSource.current) return;
    const src = pendingSource.current;
    const canDrop = callbacksRef.current.canDrop;
    if (canDrop && !canDrop(src, fsPath)) return;
    callbacksRef.current.onDrop(src, fsPath);
  }, []);

  return { dragState, onDragStart, onTargetEnter, onTargetLeave, onTargetDrop };
}
