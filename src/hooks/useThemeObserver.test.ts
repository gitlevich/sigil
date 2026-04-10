/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { useThemeObserver } from "./useThemeObserver";

vi.mock("../components/Workspace/sigilExtensions", () => ({
  getThemeExtension: vi.fn().mockReturnValue([]),
}));

describe("useThemeObserver", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sets up MutationObserver on mount", () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");
    const compartment = new Compartment();
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "test", extensions: [compartment.of([])] }),
      parent,
    });
    const viewRef = { current: view };

    renderHook(() => useThemeObserver(viewRef, compartment));

    expect(observeSpy).toHaveBeenCalledWith(
      document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] },
    );
    view.destroy();
  });

  it("disconnects observer on unmount", () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");
    const compartment = new Compartment();
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "test", extensions: [compartment.of([])] }),
      parent,
    });
    const viewRef = { current: view };

    const { unmount } = renderHook(() => useThemeObserver(viewRef, compartment));
    unmount();

    expect(disconnectSpy).toHaveBeenCalled();
    view.destroy();
  });

  it("works with Compartment ref", () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");
    const compartment = new Compartment();
    const compartmentRef = { current: compartment };
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "test", extensions: [compartment.of([])] }),
      parent,
    });
    const viewRef = { current: view };

    renderHook(() => useThemeObserver(viewRef, compartmentRef));

    expect(observeSpy).toHaveBeenCalled();
    view.destroy();
  });

  it("reconfigures theme when data-theme attribute changes", async () => {
    const compartment = new Compartment();
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "test", extensions: [compartment.of([])] }),
      parent,
    });
    const viewRef = { current: view };
    const dispatchSpy = vi.spyOn(view, "dispatch");

    renderHook(() => useThemeObserver(viewRef, compartment));

    // Trigger the MutationObserver by changing the attribute
    document.documentElement.setAttribute("data-theme", "dark");

    // MutationObserver callbacks are async — wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(dispatchSpy).toHaveBeenCalled();
    view.destroy();
  });

  it("handles null viewRef gracefully", () => {
    const compartment = new Compartment();
    const viewRef = { current: null };

    expect(() => {
      renderHook(() => useThemeObserver(viewRef, compartment));
    }).not.toThrow();
  });
});
