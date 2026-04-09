import { describe, it, expect } from "vitest";
import type { ApplicationSpec, SigilFolder } from "../tauri";
import { resolveCurrentFolder, scopeInfo, isImportedPath } from "./WorkspaceContext";
import type { WorkspaceState } from "./WorkspaceContext";

function makeFolder(name: string, children: SigilFolder[] = [], language = ""): SigilFolder {
  return {
    name,
    path: `/mock/${name}`,
    language,
    affordances: [],
    invariants: [],
    children,
    images: [],
    isImported: false,
  };
}

function makeSpec(root: SigilFolder, importedOntologies?: SigilFolder): ApplicationSpec {
  return {
    name: root.name,
    rootPath: root.path,
    vision: "",
    root,
    importedOntologies,
  };
}

function makeState(
  spec: ApplicationSpec,
  currentPath: string[] = [],
  history: string[][] = [],
): WorkspaceState {
  return { spec, currentPath, history, collapsedPaths: [], targetLine: null };
}

// ── Test fixtures ──

const childA = makeFolder("ChildA");
const childB = makeFolder("ChildB");
const parent = makeFolder("Parent", [childA, childB]);
const root = makeFolder("App", [parent]);

const libConcept1 = makeFolder("Concept1");
const libConcept2 = makeFolder("Concept2");
const libRoot = makeFolder("AttentionLanguage", [libConcept1, libConcept2]);
const importedOntologies = makeFolder("Imported Ontologies", [libRoot]);

const spec = makeSpec(root, importedOntologies);

// ── NAVIGATE reducer ──

// We test the reducer logic inline since it's not exported.
// Instead we test the derived functions that depend on correct state.

describe("resolveCurrentFolder", () => {
  it("resolves root path", () => {
    const state = makeState(spec, []);
    const folder = resolveCurrentFolder(state);
    expect(folder?.name).toBe("App");
  });

  it("resolves nested path in main tree", () => {
    const state = makeState(spec, ["Parent", "ChildA"]);
    const folder = resolveCurrentFolder(state);
    expect(folder?.name).toBe("ChildA");
  });

  it("returns null for invalid path", () => {
    const state = makeState(spec, ["Nonexistent"]);
    const folder = resolveCurrentFolder(state);
    expect(folder).toBeNull();
  });

  it("resolves path in imported ontologies", () => {
    const state = makeState(spec, ["Imported Ontologies", "AttentionLanguage", "Concept1"]);
    const folder = resolveCurrentFolder(state);
    expect(folder?.name).toBe("Concept1");
  });

  it("resolves imported ontologies root", () => {
    const state = makeState(spec, ["Imported Ontologies", "AttentionLanguage"]);
    const folder = resolveCurrentFolder(state);
    expect(folder?.name).toBe("AttentionLanguage");
  });

  it("returns null for invalid imported path", () => {
    const state = makeState(spec, ["Imported Ontologies", "Nonexistent"]);
    const folder = resolveCurrentFolder(state);
    expect(folder).toBeNull();
  });
});

describe("scopeInfo", () => {
  it("returns main root and full path for non-imported", () => {
    const state = makeState(spec, ["Parent", "ChildA"]);
    const info = scopeInfo(state);
    expect(info.scopeRoot.name).toBe("App");
    expect(info.scopePath).toEqual(["Parent", "ChildA"]);
  });

  it("returns imported root and stripped path for imported", () => {
    const state = makeState(spec, ["Imported Ontologies", "AttentionLanguage", "Concept1"]);
    const info = scopeInfo(state);
    expect(info.scopeRoot.name).toBe("Imported Ontologies");
    expect(info.scopePath).toEqual(["AttentionLanguage", "Concept1"]);
  });
});

describe("isImportedPath", () => {
  it("false for main tree", () => {
    expect(isImportedPath(makeState(spec, ["Parent"]))).toBe(false);
  });

  it("true for imported path", () => {
    expect(isImportedPath(makeState(spec, ["Imported Ontologies", "AttentionLanguage"]))).toBe(true);
  });

  it("false when no imported ontologies in spec", () => {
    const noImportSpec = makeSpec(root);
    expect(isImportedPath(makeState(noImportSpec, ["Imported Ontologies", "Anything"]))).toBe(false);
  });
});

// ── PATCH_LANGUAGE / PATCH_PROPERTY reducer ──
// We simulate the reducer inline since it's not exported.

describe("PATCH_LANGUAGE", () => {
  function patchLanguage(state: WorkspaceState, path: string[], content: string): WorkspaceState {
    // Simulate patchNodeInTree + PATCH_LANGUAGE reducer case
    function patchNode(root: SigilFolder, p: string[], updater: (f: SigilFolder) => SigilFolder): SigilFolder {
      if (p.length === 0) return updater(root);
      const [head, ...rest] = p;
      return { ...root, children: root.children.map(c => c.name === head ? patchNode(c, rest, updater) : c) };
    }
    const updated = patchNode(state.spec.root, path, (f) => ({ ...f, language: content }));
    return { ...state, spec: { ...state.spec, root: updated } };
  }

  it("patches language at root", () => {
    const state = makeState(spec, []);
    const result = patchLanguage(state, [], "new root content");
    expect(result.spec.root.language).toBe("new root content");
  });

  it("patches language at nested path", () => {
    const state = makeState(spec, ["Parent", "ChildA"]);
    const result = patchLanguage(state, ["Parent", "ChildA"], "edited");
    const child = result.spec.root.children[0].children[0];
    expect(child.name).toBe("ChildA");
    expect(child.language).toBe("edited");
  });

  it("produces a new root identity", () => {
    const state = makeState(spec, ["Parent"]);
    const result = patchLanguage(state, ["Parent"], "changed");
    expect(result.spec.root).not.toBe(state.spec.root);
  });

  it("does not mutate siblings", () => {
    const state = makeState(spec, ["Parent", "ChildA"]);
    const result = patchLanguage(state, ["Parent", "ChildA"], "edited");
    const childB = result.spec.root.children[0].children[1];
    expect(childB).toBe(state.spec.root.children[0].children[1]);
  });
});

describe("PATCH_PROPERTY", () => {
  const affFolder = makeFolder("Target", [], "");
  Object.assign(affFolder, {
    affordances: [{ name: "spin", content: "original spin" }],
    invariants: [{ name: "round", content: "original round" }],
  });
  const propRoot = makeFolder("Root", [affFolder]);
  const propSpec = makeSpec(propRoot);

  function patchProperty(
    state: WorkspaceState,
    path: string[],
    kind: "affordance" | "invariant",
    name: string,
    content: string,
  ): WorkspaceState {
    const key = kind === "affordance" ? "affordances" : "invariants";
    function patchNode(root: SigilFolder, p: string[], updater: (f: SigilFolder) => SigilFolder): SigilFolder {
      if (p.length === 0) return updater(root);
      const [head, ...rest] = p;
      return { ...root, children: root.children.map(c => c.name === head ? patchNode(c, rest, updater) : c) };
    }
    const updated = patchNode(state.spec.root, path, (f) => ({
      ...f,
      [key]: f[key].map((p: { name: string; content: string }) =>
        p.name === name ? { ...p, content } : p
      ),
    }));
    return { ...state, spec: { ...state.spec, root: updated } };
  }

  it("patches affordance content", () => {
    const state = makeState(propSpec, ["Target"]);
    const result = patchProperty(state, ["Target"], "affordance", "spin", "updated spin");
    expect(result.spec.root.children[0].affordances[0].content).toBe("updated spin");
  });

  it("patches invariant content", () => {
    const state = makeState(propSpec, ["Target"]);
    const result = patchProperty(state, ["Target"], "invariant", "round", "updated round");
    expect(result.spec.root.children[0].invariants[0].content).toBe("updated round");
  });

  it("does not affect other properties", () => {
    const state = makeState(propSpec, ["Target"]);
    const result = patchProperty(state, ["Target"], "affordance", "spin", "changed");
    expect(result.spec.root.children[0].invariants[0].content).toBe("original round");
  });

  it("produces new root identity", () => {
    const state = makeState(propSpec, ["Target"]);
    const result = patchProperty(state, ["Target"], "affordance", "spin", "changed");
    expect(result.spec.root).not.toBe(state.spec.root);
  });
});

// ── Back navigation ──

describe("back navigation (reducer logic)", () => {
  // Since the reducer is not exported, we simulate its behavior to verify the contract.
  // The reducer pushes currentPath to history on NAVIGATE, pops on BACK.

  function navigate(state: WorkspaceState, path: string[], targetLine?: number): WorkspaceState {
    return {
      ...state,
      currentPath: path,
      history: [...state.history, state.currentPath],
      targetLine: targetLine ?? null,
    };
  }

  function clearTargetLine(state: WorkspaceState): WorkspaceState {
    return { ...state, targetLine: null };
  }

  function back(state: WorkspaceState): WorkspaceState {
    if (state.history.length === 0) return state;
    return {
      ...state,
      currentPath: state.history[state.history.length - 1],
      history: state.history.slice(0, -1),
    };
  }

  it("back restores previous path", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"]);
    state = navigate(state, ["Parent", "ChildA"]);
    expect(state.currentPath).toEqual(["Parent", "ChildA"]);
    expect(state.history).toHaveLength(2);

    state = back(state);
    expect(state.currentPath).toEqual(["Parent"]);
    expect(state.history).toHaveLength(1);

    state = back(state);
    expect(state.currentPath).toEqual([]);
    expect(state.history).toHaveLength(0);
  });

  it("back is no-op when history is empty", () => {
    const state = makeState(spec, ["Parent"]);
    const result = back(state);
    expect(result).toBe(state);
  });

  it("back works across imported/main boundary", () => {
    let state = makeState(spec, ["Parent"]);
    state = navigate(state, ["Imported Ontologies", "AttentionLanguage"]);
    state = navigate(state, ["Imported Ontologies", "AttentionLanguage", "Concept1"]);

    state = back(state);
    expect(state.currentPath).toEqual(["Imported Ontologies", "AttentionLanguage"]);
    expect(resolveCurrentFolder(state)?.name).toBe("AttentionLanguage");

    state = back(state);
    expect(state.currentPath).toEqual(["Parent"]);
    expect(resolveCurrentFolder(state)?.name).toBe("Parent");
  });

  it("history grows linearly with navigations", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"]);
    state = navigate(state, ["Parent", "ChildA"]);
    state = navigate(state, ["Parent", "ChildB"]);
    expect(state.history).toHaveLength(3);
    expect(state.history[0]).toEqual([]);
    expect(state.history[1]).toEqual(["Parent"]);
    expect(state.history[2]).toEqual(["Parent", "ChildA"]);
  });

  it("navigate with targetLine sets targetLine", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"], 5);
    expect(state.targetLine).toBe(5);
  });

  it("navigate without targetLine clears targetLine", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"], 5);
    state = navigate(state, ["Parent", "ChildA"]);
    expect(state.targetLine).toBeNull();
  });

  it("clearTargetLine resets targetLine to null", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"], 5);
    state = clearTargetLine(state);
    expect(state.targetLine).toBeNull();
  });

  it("repeated navigate to same path with different targetLine updates targetLine", () => {
    let state = makeState(spec, []);
    state = navigate(state, ["Parent"], 5);
    state = clearTargetLine(state);
    state = navigate(state, ["Parent"], 10);
    expect(state.targetLine).toBe(10);
    expect(state.currentPath).toEqual(["Parent"]);
  });
});
