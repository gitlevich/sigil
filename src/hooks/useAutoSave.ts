import { useRef, useCallback, useEffect } from "react";
import { api } from "../tauri";

// ── Base version tracking ──
// Stores the content as last read from or written to disk, per path.
// Used for three-way conflict detection: base vs local vs disk.
const baseContent = new Map<string, string>();

export function getBase(path: string): string | null {
  return baseContent.get(path) ?? null;
}

export function setBase(path: string, content: string): void {
  baseContent.set(path, content);
}

export function clearBase(path: string): void {
  baseContent.delete(path);
}

// ── Pause control ──
// When a conflict is detected for a path, auto-save pauses for that path.
const pausedPaths = new Set<string>();

export function pauseAutoSaveFor(path: string): void {
  pausedPaths.add(path);
}

export function resumeAutoSaveFor(path: string): void {
  pausedPaths.delete(path);
}

export function isAutoSavePaused(path: string): boolean {
  return pausedPaths.has(path);
}

// ── Pending write tracking ──
let globalPendingPath: string | null = null;

let globalPendingContent: string | null = null;

/**
 * Discard any in-flight auto-save when the sigil tree was mutated
 * externally (e.g. a tool deleted the sigil the user was editing).
 * Without this, the pending timer fires 500ms after a delete and
 * api.writeFile recreates the directory — the "ghost sigil" bug.
 *
 * Pausing the path makes the instance's writeToDisk a no-op when the
 * timer finally fires. Clearing the globals keeps conflict-detection
 * code from seeing stale pending content.
 */
export function discardPendingAutoSave(): void {
  if (globalPendingPath) {
    pauseAutoSaveFor(globalPendingPath);
  }
  globalPendingPath = null;
  globalPendingContent = null;
}

export function getAutoSavePendingPath(): string | null {
  return globalPendingPath;
}

export function getAutoSavePendingContent(): string | null {
  return globalPendingContent;
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
    globalPendingPath = null;
    globalPendingContent = null;

    if (isAutoSavePaused(path)) return;

    // Update base BEFORE the write so the conflict check never sees a stale base
    // for our own auto-save. If the write fails, revert.
    const prevBase = baseContent.get(path) ?? null;
    baseContent.set(path, content);

    api.writeFile(path, content)
      .catch((err) => {
        // Revert base — disk still has the old content
        if (prevBase !== null) {
          baseContent.set(path, prevBase);
        } else {
          baseContent.delete(path);
        }
        console.error("Auto-save failed:", err);
      });
  }, []);

  const save = useCallback((path: string, content: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    globalPendingPath = path;
    globalPendingContent = content;
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

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    globalPendingPath = null;
    globalPendingContent = null;
  }, []);

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
        if (!isAutoSavePaused(pending.path)) {
          api.writeFile(pending.path, pending.content).catch((err) => {
            console.error("Auto-save flush on unmount failed:", err);
          });
        }
        pendingRef.current = null;
        globalPendingPath = null;
        globalPendingContent = null;
      }
    };
  }, []);

  return { save, flush, cancel };
}
