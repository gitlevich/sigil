import { useRef, useCallback } from "react";
import { api } from "../tauri";

// Shared flag so the file watcher can check if we have pending writes.
// This prevents the watcher from reloading the tree and overwriting
// in-memory edits that haven't been flushed to disk yet.
let globalDirty = false;

export function isAutoSaveDirty(): boolean {
  return globalDirty;
}

export function useAutoSave(delayMs = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((path: string, content: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    globalDirty = true;
    timerRef.current = setTimeout(() => {
      api.writeFile(path, content)
        .catch((err) => {
          console.error("Auto-save failed:", err);
        })
        .finally(() => {
          // Delay clearing dirty so the file watcher event from
          // this write has time to arrive and be ignored.
          setTimeout(() => {
            globalDirty = false;
          }, 500);
        });
    }, delayMs);
  }, [delayMs]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { save, flush };
}
