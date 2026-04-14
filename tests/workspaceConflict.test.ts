import { describe, it, expect } from "vitest";
import { reducer, WorkspaceState, FileConflict } from "../src/state/WorkspaceContext";

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    spec: { name: "test", rootPath: "/test", vision: "", root: { name: "test", path: "/test", language: "", affordances: [], invariants: [], children: [], images: [] } },
    currentPath: [],
    history: [],
    collapsedPaths: [],
    targetLine: null,
    conflict: null,
    ...overrides,
  };
}

describe("conflict reducer actions", () => {
  it("SET_CONFLICT stores the conflict", () => {
    const state = makeState();
    const conflict: FileConflict = {
      path: "/test/language.md",
      diskContent: "disk version",
      localContent: "local version",
      deleted: false,
    };
    const next = reducer(state, { type: "SET_CONFLICT", conflict });
    expect(next.conflict).toEqual(conflict);
  });

  it("RESOLVE_CONFLICT clears the conflict", () => {
    const conflict: FileConflict = {
      path: "/test/language.md",
      diskContent: "disk",
      localContent: "local",
      deleted: false,
    };
    const state = makeState({ conflict });
    const next = reducer(state, { type: "RESOLVE_CONFLICT" });
    expect(next.conflict).toBeNull();
  });

  it("SET_CONFLICT replaces existing conflict", () => {
    const first: FileConflict = { path: "/a", diskContent: "a", localContent: "a", deleted: false };
    const second: FileConflict = { path: "/b", diskContent: "b", localContent: "b", deleted: true };
    const state = makeState({ conflict: first });
    const next = reducer(state, { type: "SET_CONFLICT", conflict: second });
    expect(next.conflict).toEqual(second);
  });

  it("SET_CONFLICT with deleted flag", () => {
    const state = makeState();
    const conflict: FileConflict = {
      path: "/test/language.md",
      diskContent: "",
      localContent: "my edits",
      deleted: true,
    };
    const next = reducer(state, { type: "SET_CONFLICT", conflict });
    expect(next.conflict?.deleted).toBe(true);
    expect(next.conflict?.localContent).toBe("my edits");
  });

  it("other actions preserve conflict state", () => {
    const conflict: FileConflict = { path: "/test", diskContent: "d", localContent: "l", deleted: false };
    const state = makeState({ conflict });
    const next = reducer(state, { type: "NAVIGATE", path: ["child"] });
    expect(next.conflict).toEqual(conflict);
  });
});
