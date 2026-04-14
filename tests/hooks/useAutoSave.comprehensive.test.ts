/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/tauri", () => ({
  api: { writeFile: (...args: any[]) => mockWriteFile(...args) },
}));

import { useAutoSave, getAutoSavePendingPath, getAutoSavePendingContent } from "../../src/hooks/useAutoSave";

describe("pending path tracking", () => {
  it("returns null initially", () => {
    expect(getAutoSavePendingPath()).toBeNull();
  });
});

describe("useAutoSave hook", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("save schedules a write after delay", () => {
    const { result } = renderHook(() => useAutoSave(100));
    act(() => result.current.save("/test.md", "content"));
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(getAutoSavePendingPath()).toBe("/test.md");
    expect(getAutoSavePendingContent()).toBe("content");
    act(() => vi.advanceTimersByTime(100));
    expect(mockWriteFile).toHaveBeenCalledWith("/test.md", "content");
  });

  it("rapid saves debounce to latest", () => {
    const { result } = renderHook(() => useAutoSave(100));
    act(() => { result.current.save("/f", "v1"); result.current.save("/f", "v2"); result.current.save("/f", "v3"); });
    act(() => vi.advanceTimersByTime(100));
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith("/f", "v3");
  });

  it("flush writes pending immediately", () => {
    const { result } = renderHook(() => useAutoSave(1000));
    act(() => result.current.save("/f", "pending"));
    act(() => result.current.flush());
    expect(mockWriteFile).toHaveBeenCalledWith("/f", "pending");
  });

  it("flush is no-op when nothing pending", () => {
    const { result } = renderHook(() => useAutoSave(100));
    act(() => result.current.flush());
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("unmount flushes pending writes", () => {
    const { result, unmount } = renderHook(() => useAutoSave(1000));
    act(() => result.current.save("/f", "unsaved"));
    unmount();
    expect(mockWriteFile).toHaveBeenCalledWith("/f", "unsaved");
  });

  it("unmount is safe when nothing pending", () => {
    const { unmount } = renderHook(() => useAutoSave(100));
    expect(() => unmount()).not.toThrow();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("flush after timer is no-op", () => {
    const { result } = renderHook(() => useAutoSave(100));
    act(() => result.current.save("/f", "v1"));
    act(() => vi.advanceTimersByTime(100));
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    act(() => result.current.flush());
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("cancel clears pending write", () => {
    const { result } = renderHook(() => useAutoSave(100));
    act(() => result.current.save("/f", "content"));
    expect(getAutoSavePendingPath()).toBe("/f");
    act(() => result.current.cancel());
    expect(getAutoSavePendingPath()).toBeNull();
    expect(getAutoSavePendingContent()).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
