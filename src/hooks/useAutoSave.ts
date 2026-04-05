import { useRef, useCallback, useEffect } from "react";
import { api } from "../tauri";

// Shared flag so the file watcher can check if we have pending writes.
// This prevents the watcher from reloading the tree and overwriting
// in-memory edits that haven't been flushed to disk yet.
let globalDirty = false;

export function isAutoSaveDirty(): boolean {
  return globalDirty;
}

interface PendingWrite {
  path: string;
  content: string;
}

export function useAutoSave(delayMs = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingWrite | null>(null);

  const writeToDisk = useCallback((path: string, content: string) => {
    pendingRef.current = null;
    api.writeFile(path, content)
      .catch((err) => {
        console.error("Auto-save failed:", err);
      })
      .finally(() => {
        setTimeout(() => {
          globalDirty = false;
        }, 500);
      });
  }, []);

  const save = useCallback((path: string, content: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    globalDirty = true;
    pendingRef.current = { path, content };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      writeToDisk(path, content);
    }, delayMs);
  }, [delayMs, writeToDisk]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      writeToDisk(pending.path, pending.content);
    }
  }, [writeToDisk]);

  // Flush on unmount so no pending writes are ever lost
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) {
        // Fire-and-forget: component is unmounting, just ensure the write starts
        api.writeFile(pending.path, pending.content).catch((err) => {
          console.error("Auto-save flush on unmount failed:", err);
        });
        pendingRef.current = null;
      }
    };
  }, []);

  return { save, flush };
}
