/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMouseDrag, DRAG_THRESHOLD, createDragGhost } from "./useMouseDrag";

describe("useMouseDrag hook", () => {
  const onDrop = vi.fn();
  const canDrop = vi.fn().mockReturnValue(true);
  beforeEach(() => vi.clearAllMocks());

  it("initial state is idle", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    expect(result.current.dragState.sourcePath).toBeNull();
    expect(result.current.dragState.targetPath).toBeNull();
  });

  it("ignores non-left button", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    const stop = vi.fn();
    act(() => result.current.onDragStart({ button: 2, clientX: 0, clientY: 0, stopPropagation: stop, currentTarget: document.createElement("div") } as any, "/a"));
    expect(stop).not.toHaveBeenCalled();
  });

  it("left button sets up pending", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    const stop = vi.fn();
    act(() => result.current.onDragStart({ button: 0, clientX: 10, clientY: 10, stopPropagation: stop, currentTarget: document.createElement("div") } as any, "/a"));
    expect(stop).toHaveBeenCalled();
  });

  it("onTargetEnter/Leave/Drop do nothing when not dragging", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    act(() => result.current.onTargetEnter("/t"));
    expect(result.current.dragState.targetPath).toBeNull();
    act(() => result.current.onTargetLeave("/t"));
    act(() => result.current.onTargetDrop("/t"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("full drag flow", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => {} });
    act(() => result.current.onDragStart({ button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn(), currentTarget: el } as any, "/src"));
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 10 })));
    expect(result.current.dragState.sourcePath).toBe("/src");
    act(() => result.current.onTargetEnter("/tgt"));
    expect(result.current.dragState.targetPath).toBe("/tgt");
    act(() => result.current.onTargetDrop("/tgt"));
    expect(onDrop).toHaveBeenCalledWith("/src", "/tgt");
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
  });

  it("canDrop rejection", () => {
    canDrop.mockReturnValue(false);
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => {} });
    act(() => result.current.onDragStart({ button: 0, clientX: 0, clientY: 0, stopPropagation: vi.fn(), currentTarget: el } as any, "/s"));
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 0 })));
    act(() => result.current.onTargetEnter("/t"));
    expect(result.current.dragState.targetPath).toBeNull();
    canDrop.mockReturnValue(true);
  });

  it("sub-threshold mousemove does not start drag", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop }));
    const el = document.createElement("div");
    act(() => result.current.onDragStart({ button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn(), currentTarget: el } as any, "/s"));
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 12, clientY: 10 })));
    expect(result.current.dragState.sourcePath).toBeNull();
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
  });

  it("onTargetLeave clears matching target", () => {
    const { result } = renderHook(() => useMouseDrag({ onDrop, canDrop }));
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => {} });
    act(() => result.current.onDragStart({ button: 0, clientX: 0, clientY: 0, stopPropagation: vi.fn(), currentTarget: el } as any, "/s"));
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 0 })));
    act(() => result.current.onTargetEnter("/t"));
    expect(result.current.dragState.targetPath).toBe("/t");
    act(() => result.current.onTargetLeave("/t"));
    expect(result.current.dragState.targetPath).toBeNull();
  });
});

describe("DRAG_THRESHOLD", () => {
  it("is 5 pixels", () => {
    expect(DRAG_THRESHOLD).toBe(5);
  });
});
