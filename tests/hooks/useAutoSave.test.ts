import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWriteFile = vi.fn();

// Tests the save/flush/unmount contract that useAutoSave must uphold:
// No pending write is ever silently dropped.

function createAutoSave(delayMs = 500) {
  let timerRef: ReturnType<typeof setTimeout> | null = null;
  let pendingWrite: { path: string; content: string } | null = null;

  function writeToDisk(path: string, content: string) {
    pendingWrite = null;
    mockWriteFile(path, content);
  }

  function save(path: string, content: string) {
    if (timerRef) clearTimeout(timerRef);
    pendingWrite = { path, content };
    timerRef = setTimeout(() => {
      timerRef = null;
      writeToDisk(path, content);
    }, delayMs);
  }

  function flush() {
    if (timerRef) {
      clearTimeout(timerRef);
      timerRef = null;
    }
    if (pendingWrite) {
      writeToDisk(pendingWrite.path, pendingWrite.content);
    }
  }

  function unmount() {
    if (timerRef) {
      clearTimeout(timerRef);
      timerRef = null;
    }
    if (pendingWrite) {
      mockWriteFile(pendingWrite.path, pendingWrite.content);
      pendingWrite = null;
    }
  }

  function hasPending() { return pendingWrite !== null; }
  function fireTimer() {
    if (timerRef) {
      clearTimeout(timerRef);
      timerRef = null;
      if (pendingWrite) writeToDisk(pendingWrite.path, pendingWrite.content);
    }
  }

  return { save, flush, unmount, hasPending, fireTimer };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAutoSave contract", () => {
  it("save queues a pending write", () => {
    const { save, hasPending } = createAutoSave();
    save("/a.md", "v1");
    expect(hasPending()).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("timer firing writes to disk and clears pending", () => {
    const { save, hasPending, fireTimer } = createAutoSave();
    save("/a.md", "v1");
    fireTimer();
    expect(mockWriteFile).toHaveBeenCalledWith("/a.md", "v1");
    expect(hasPending()).toBe(false);
  });

  it("rapid edits keep only the latest content", () => {
    const { save, fireTimer } = createAutoSave();
    save("/a.md", "v1");
    save("/a.md", "v2");
    save("/a.md", "v3");
    fireTimer();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith("/a.md", "v3");
  });

  it("flush writes pending data immediately instead of dropping it", () => {
    const { save, flush } = createAutoSave();
    save("/a.md", "content");
    flush();
    expect(mockWriteFile).toHaveBeenCalledWith("/a.md", "content");
  });

  it("flush is a no-op when nothing is pending", () => {
    const { flush } = createAutoSave();
    flush();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("flush after timer already fired is a no-op", () => {
    const { save, flush, fireTimer } = createAutoSave();
    save("/a.md", "v1");
    fireTimer();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    flush();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("writes pending data on unmount", () => {
    const { save, unmount } = createAutoSave();
    save("/a.md", "unsaved");
    unmount();
    expect(mockWriteFile).toHaveBeenCalledWith("/a.md", "unsaved");
  });

  it("unmount is a no-op when nothing is pending", () => {
    const { unmount } = createAutoSave();
    unmount();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("unmount after flush does not double-write", () => {
    const { save, flush, unmount } = createAutoSave();
    save("/a.md", "v1");
    flush();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("unmount after timer fired does not double-write", () => {
    const { save, fireTimer, unmount } = createAutoSave();
    save("/a.md", "v1");
    fireTimer();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});
