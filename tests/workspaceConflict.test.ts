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
    mergeViewOpen: false,
    ...overrides,
  };
}

function makeConflict(overrides: Partial<FileConflict> = {}): FileConflict {
  return {
    path: "/test/language.md",
    base: "base",
    diskContent: "disk version",
    localContent: "local version",
    deleted: false,
    mergedCount: 0,
    conflictCount: 1,
    ...overrides,
  };
}

describe("conflict reducer actions", () => {
  it("SET_CONFLICT stores the conflict", () => {
    const state = makeState();
    const conflict = makeConflict();
    const next = reducer(state, { type: "SET_CONFLICT", conflict });
    expect(next.conflict).toEqual(conflict);
  });

  it("RESOLVE_CONFLICT clears the conflict", () => {
    const state = makeState({ conflict: makeConflict(), mergeViewOpen: true });
    const next = reducer(state, { type: "RESOLVE_CONFLICT" });
    expect(next.conflict).toBeNull();
    expect(next.mergeViewOpen).toBe(false);
  });

  it("SET_CONFLICT replaces existing conflict and closes any open merge view", () => {
    const first = makeConflict({ path: "/a" });
    const second = makeConflict({ path: "/b", deleted: true });
    const state = makeState({ conflict: first, mergeViewOpen: true });
    const next = reducer(state, { type: "SET_CONFLICT", conflict: second });
    expect(next.conflict).toEqual(second);
    expect(next.mergeViewOpen).toBe(false);
  });

  it("SET_CONFLICT with deleted flag", () => {
    const state = makeState();
    const conflict = makeConflict({ deleted: true, diskContent: "", localContent: "my edits" });
    const next = reducer(state, { type: "SET_CONFLICT", conflict });
    expect(next.conflict?.deleted).toBe(true);
    expect(next.conflict?.localContent).toBe("my edits");
  });

  it("other actions preserve conflict state", () => {
    const conflict = makeConflict();
    const state = makeState({ conflict });
    const next = reducer(state, { type: "NAVIGATE", path: ["child"] });
    expect(next.conflict).toEqual(conflict);
  });

  it("OPEN_MERGE_VIEW only opens when a conflict exists", () => {
    const none = reducer(makeState(), { type: "OPEN_MERGE_VIEW" });
    expect(none.mergeViewOpen).toBe(false);

    const withConflict = reducer(makeState({ conflict: makeConflict() }), { type: "OPEN_MERGE_VIEW" });
    expect(withConflict.mergeViewOpen).toBe(true);
  });

  it("CLOSE_MERGE_VIEW keeps the conflict but closes the view", () => {
    const state = makeState({ conflict: makeConflict(), mergeViewOpen: true });
    const next = reducer(state, { type: "CLOSE_MERGE_VIEW" });
    expect(next.mergeViewOpen).toBe(false);
    expect(next.conflict).not.toBeNull();
  });
});
