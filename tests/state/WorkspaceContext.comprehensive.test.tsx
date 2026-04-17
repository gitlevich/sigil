/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import type { IdeaSpec, SigilFolder } from "../../src/tauri";
import {
  resolveCurrentFolder, scopeInfo, isImportedPath,
  WorkspaceProvider, useWorkspaceState, useWorkspaceDispatch, useWorkspaceActions,
} from "../../src/../src/state/WorkspaceContext";
import type { WorkspaceState } from "../../src/../src/state/WorkspaceContext";

const mockReadSigil = vi.fn();
vi.mock("../../src/tauri", () => ({
  api: { readSigil: (...args: any[]) => mockReadSigil(...args) },
}));

function makeFolder(name: string, children: SigilFolder[] = [], language = ""): SigilFolder {
  return { name, path: `/mock/${name}`, language, affordances: [], invariants: [], children, images: [], isImported: false };
}

function makeSpec(root: SigilFolder, importedOntologies?: SigilFolder): IdeaSpec {
  return { name: root.name, rootPath: root.path, vision: "", root, importedOntologies };
}

const root = makeFolder("App", [makeFolder("Child")]);
const importedOntologies = makeFolder("Imported Ontologies", [makeFolder("AttentionLanguage", [makeFolder("Concept1")])]);
const spec = makeSpec(root, importedOntologies);

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceProvider spec={spec}>{children}</WorkspaceProvider>;
}

describe("WorkspaceProvider integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("provides initial state", () => {
    const { result } = renderHook(() => useWorkspaceState(), { wrapper });
    expect(result.current.spec.name).toBe("App");
    expect(result.current.currentPath).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.collapsedPaths).toEqual([]);
    expect(result.current.targetLine).toBeNull();
  });

  it("NAVIGATE updates path and history", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "NAVIGATE", path: ["Child"] }));
    expect(result.current.s.currentPath).toEqual(["Child"]);
    expect(result.current.s.history).toEqual([[]]);
  });

  it("NAVIGATE with targetLine", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "NAVIGATE", path: ["Child"], targetLine: 42 }));
    expect(result.current.s.targetLine).toBe(42);
  });

  it("CLEAR_TARGET_LINE", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "NAVIGATE", path: ["Child"], targetLine: 10 }));
    act(() => result.current.d({ type: "CLEAR_TARGET_LINE" }));
    expect(result.current.s.targetLine).toBeNull();
  });

  it("BACK pops history", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "NAVIGATE", path: ["Child"] }));
    act(() => result.current.d({ type: "BACK" }));
    expect(result.current.s.currentPath).toEqual([]);
    expect(result.current.s.history).toEqual([]);
  });

  it("BACK is no-op when history empty", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "BACK" }));
    expect(result.current.s.currentPath).toEqual([]);
  });

  it("UPDATE_SPEC replaces spec", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    const newSpec = makeSpec(makeFolder("New"));
    act(() => result.current.d({ type: "UPDATE_SPEC", spec: newSpec }));
    expect(result.current.s.spec.name).toBe("New");
  });

  it("SET_COLLAPSED_PATHS", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "SET_COLLAPSED_PATHS", paths: ["a", "b"] }));
    expect(result.current.s.collapsedPaths).toEqual(["a", "b"]);
  });

  it("TOGGLE_COLLAPSE adds then removes", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const d = useWorkspaceDispatch();
      return { s, d };
    }, { wrapper });
    act(() => result.current.d({ type: "TOGGLE_COLLAPSE", pathKey: "Child" }));
    expect(result.current.s.collapsedPaths).toContain("Child");
    act(() => result.current.d({ type: "TOGGLE_COLLAPSE", pathKey: "Child" }));
    expect(result.current.s.collapsedPaths).not.toContain("Child");
  });
});

describe("useWorkspaceActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("navigate updates path", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const a = useWorkspaceActions();
      return { s, a };
    }, { wrapper });
    act(() => result.current.a.navigate(["Child"]));
    expect(result.current.s.currentPath).toEqual(["Child"]);
  });

  it("navigate with targetLine", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const a = useWorkspaceActions();
      return { s, a };
    }, { wrapper });
    act(() => result.current.a.navigate(["Child"], 5));
    expect(result.current.s.targetLine).toBe(5);
  });

  it("back restores previous path", () => {
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const a = useWorkspaceActions();
      return { s, a };
    }, { wrapper });
    act(() => result.current.a.navigate(["Child"]));
    act(() => result.current.a.back());
    expect(result.current.s.currentPath).toEqual([]);
  });

  it("reload calls api.readSigil and updates spec", async () => {
    const newSpec = makeSpec(makeFolder("Updated"));
    mockReadSigil.mockResolvedValue(newSpec);
    const { result } = renderHook(() => {
      const s = useWorkspaceState();
      const a = useWorkspaceActions();
      return { s, a };
    }, { wrapper });
    await act(async () => { await result.current.a.reload(); });
    expect(mockReadSigil).toHaveBeenCalledWith(spec.rootPath);
    expect(result.current.s.spec.name).toBe("Updated");
  });
});

describe("useWorkspaceState outside provider", () => {
  it("throws", () => {
    expect(() => renderHook(() => useWorkspaceState())).toThrow("useWorkspaceState must be used within WorkspaceProvider");
  });
});
