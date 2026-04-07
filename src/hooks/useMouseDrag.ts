import { useRef, useCallback, useEffect, useState } from "react";

/** Threshold in pixels before a mousedown becomes a drag. */
const DRAG_THRESHOLD = 5;

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

/**
 * Mouse-based drag-and-drop that bypasses native NSDragging.
 *
 * Tauri's WKWebView subclass (wry) overrides NSDraggingDestination,
 * which on macOS 26+ interferes with HTML5 drag events.
 * This hook uses mousedown/mousemove/mouseup instead.
 */
export function useMouseDrag(callbacks: DragCallbacks) {
  const [dragState, setDragState] = useState<DragState>({ sourcePath: null, targetPath: null });
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const pendingSource = useRef<string | null>(null);
  const dragging = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const onDragStart = useCallback((e: React.MouseEvent, fsPath: string) => {
    // Only left button
    if (e.button !== 0) return;
    e.stopPropagation();
    startPos.current = { x: e.clientX, y: e.clientY };
    pendingSource.current = fsPath;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!pendingSource.current || !startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (!dragging.current && (dx * dx + dy * dy) >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        dragging.current = true;
        setDragState({ sourcePath: pendingSource.current, targetPath: null });
      }
    };

    const handleMouseUp = () => {
      if (dragging.current) {
        // Drop is handled by the target's onMouseUp — we just clean up here
        // Use a microtask so the target's onMouseUp fires first
        queueMicrotask(() => {
          dragging.current = false;
          pendingSource.current = null;
          startPos.current = null;
          setDragState({ sourcePath: null, targetPath: null });
        });
      } else {
        pendingSource.current = null;
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
