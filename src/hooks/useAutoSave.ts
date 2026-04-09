import { useRef, useCallback, useEffect } from "react";
import { api } from "../tauri";

// Per-path dirty tracking. A path is dirty from the moment save() is called
// until 500ms after its disk write completes. The file watcher checks this
// to avoid reloading paths that the user is actively editing.
const dirtyPaths = new Set<string>();

export function isAutoSaveDirty(): boolean {
  return dirtyPaths.size > 0;
}

export function isDirtyPath(path: string): boolean {
  return dirtyPaths.has(path);
}

export function useAutoSave(delayMs = 500) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRef = useRef<Map<string, string>>(new Map());

  const writeToDisk = useCallback((path: string, content: string) => {
    pendingRef.current.delete(path);
    api.writeFile(path, content)
      .catch((err) => {
        console.error("Auto-save failed:", path, err);
      })
      .finally(() => {
        setTimeout(() => {
          dirtyPaths.delete(path);
        }, 500);
      });
  }, []);

  const save = useCallback((path: string, content: string) => {
    const existing = timersRef.current.get(path);
    if (existing) clearTimeout(existing);
    dirtyPaths.add(path);
    pendingRef.current.set(path, content);
    const timer = setTimeout(() => {
      timersRef.current.delete(path);
      writeToDisk(path, content);
    }, delayMs);
    timersRef.current.set(path, timer);
  }, [delayMs, writeToDisk]);

  const flush = useCallback(() => {
    for (const [, timer] of timersRef.current) clearTimeout(timer);
    timersRef.current.clear();
    for (const [path, content] of pendingRef.current) {
      writeToDisk(path, content);
    }
  }, [writeToDisk]);

  // Flush all pending writes on unmount — no work is ever lost
  useEffect(() => {
    return () => {
      for (const [, timer] of timersRef.current) clearTimeout(timer);
      timersRef.current.clear();
      for (const [path, content] of pendingRef.current) {
        api.writeFile(path, content).catch((err) => {
          console.error("Auto-save flush on unmount failed:", path, err);
        });
      }
      pendingRef.current.clear();
    };
  }, []);

  return { save, flush };
}
