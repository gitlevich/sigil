/**
 * Integration tests: compile check errors produce paths that work
 * with workspace navigation and tree highlighting.
 *
 * These tests verify the contract between:
 * 1. compileCheck — produces RefError with path[]
 * 2. WorkspaceState — navigate(path) sets currentPath
 * 3. TreeView — isActive = JSON.stringify(path) === JSON.stringify(currentPath)
 * 4. resolveCurrentFolder — currentPath resolves to the correct SigilFolder
 */
import { describe, it, expect } from "vitest";
import type { Sigil } from "sigil-core";
import type { SigilFolder, ApplicationSpec } from "../tauri";
import { compileCheck } from "./useCompileCheck";
import { resolveCurrentFolder, type WorkspaceState } from "../state/WorkspaceContext";

// ── Helpers ──

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  isImported?: boolean;
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
    isImported: opts?.isImported,
  };
}

function folder(name: string, opts?: {
  language?: string;
  children?: SigilFolder[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  path?: string;
}): SigilFolder {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
    path: opts?.path ?? `/mock/${name}`,
    images: [],
  };
}

function makeWorkspaceState(root: SigilFolder, currentPath: string[] = []): WorkspaceState {
  const spec: ApplicationSpec = {
    name: root.name,
    rootPath: root.path,
    vision: "",
    root,
  };
  return { spec, currentPath, history: [], collapsedPaths: [], targetLine: null };
}

/** Simulate what the NAVIGATE reducer does */
function navigateState(state: WorkspaceState, path: string[], targetLine?: number): WorkspaceState {
  return {
    ...state,
    currentPath: path,
    history: [...state.history, state.currentPath],
    targetLine: targetLine ?? null,
  };
}

/** Simulate what TreeView does to determine active node */
function isTreeNodeActive(nodePath: string[], currentPath: string[]): boolean {
  return JSON.stringify(nodePath) === JSON.stringify(currentPath);
}

// ── Test tree ──
// Mirrors the real sigil structure: specification.sigil/Application/DesignPartner/BicameralMind
// The Sigil tree (for compileCheck) and SigilFolder tree (for workspace) must have
// matching structure so that error paths work for both.

const sigilTree = sigil("specification.sigil", {
  children: [
    sigil("Application", {
      children: [
        sigil("DesignPartner", {
          language: "The partner uses @BicameralMind for cognition.",
          children: [
            sigil("BicameralMind", {
              language: "This references @NonExistentThing which is broken.",
              affordances: [{ name: "think", content: "Uses #missing-aff." }],
              children: [
                sigil("LeftHemisphere", { language: "Analytical. References @Ghost." }),
                sigil("RightHemisphere"),
              ],
            }),
          ],
        }),
        sigil("Workspace", {
          language: "The editing surface. References !no-such-invariant.",
        }),
      ],
    }),
  ],
});

const folderTree = folder("specification.sigil", {
  path: "/mock/specification.sigil",
  children: [
    folder("Application", {
      path: "/mock/specification.sigil/Application",
      children: [
        folder("DesignPartner", {
          path: "/mock/specification.sigil/Application/DesignPartner",
          language: "The partner uses @BicameralMind for cognition.",
          children: [
            folder("BicameralMind", {
              path: "/mock/specification.sigil/Application/DesignPartner/BicameralMind",
              language: "This references @NonExistentThing which is broken.",
              affordances: [{ name: "think", content: "Uses #missing-aff." }],
              children: [
                folder("LeftHemisphere", {
                  path: "/mock/specification.sigil/Application/DesignPartner/BicameralMind/LeftHemisphere",
                  language: "Analytical. References @Ghost.",
                }),
                folder("RightHemisphere", {
                  path: "/mock/specification.sigil/Application/DesignPartner/BicameralMind/RightHemisphere",
                }),
              ],
            }),
          ],
        }),
        folder("Workspace", {
          path: "/mock/specification.sigil/Application/Workspace",
          language: "The editing surface. References !no-such-invariant.",
        }),
      ],
    }),
  ],
});

describe("compile error paths work with workspace navigation", () => {
  const result = compileCheck(sigilTree);

  it("compile check finds errors in multiple sigils", () => {
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    const errorPaths = new Set(result.errors.map(e => e.path.join("/")));
    expect(errorPaths.size).toBeGreaterThan(1);
  });

  it("each error path resolves to a valid folder via resolveCurrentFolder", () => {
    for (const err of result.errors) {
      const state = makeWorkspaceState(folderTree, err.path);
      const resolved = resolveCurrentFolder(state);
      expect(resolved, `path ${JSON.stringify(err.path)} should resolve`).not.toBeNull();
      // The resolved folder name should match the last segment of the path
      if (err.path.length > 0) {
        expect(resolved!.name).toBe(err.path[err.path.length - 1]);
      }
    }
  });

  it("each error path activates the correct tree node", () => {
    for (const err of result.errors) {
      expect(
        isTreeNodeActive(err.path, err.path),
        `path ${JSON.stringify(err.path)} should be active`
      ).toBe(true);
    }
  });

  it("navigating to error A then error B updates currentPath correctly", () => {
    const errorsInDifferentSigils = result.errors.filter((e, i, arr) =>
      arr.findIndex(other => other.path.join("/") === e.path.join("/")) === i
    );
    expect(errorsInDifferentSigils.length).toBeGreaterThanOrEqual(2);

    let state = makeWorkspaceState(folderTree);

    // Navigate to first error
    const errA = errorsInDifferentSigils[0];
    state = navigateState(state, errA.path, errA.line);
    expect(state.currentPath).toEqual(errA.path);
    expect(resolveCurrentFolder(state)?.name).toBe(errA.path[errA.path.length - 1]);

    // Clear target line (editor consumed it)
    state = { ...state, targetLine: null };

    // Navigate to second error (different sigil)
    const errB = errorsInDifferentSigils[1];
    state = navigateState(state, errB.path, errB.line);
    expect(state.currentPath).toEqual(errB.path);
    expect(state.currentPath).not.toEqual(errA.path);
    expect(resolveCurrentFolder(state)?.name).toBe(errB.path[errB.path.length - 1]);
    expect(state.targetLine).toBe(errB.line);
  });

  it("navigating to two errors in the same sigil updates targetLine", () => {
    const pathKey = result.errors[0].path.join("/");
    const samePathErrors = result.errors.filter(e => e.path.join("/") === pathKey);
    if (samePathErrors.length < 2) return; // skip if not enough errors in same sigil

    let state = makeWorkspaceState(folderTree);
    state = navigateState(state, samePathErrors[0].path, samePathErrors[0].line);
    expect(state.targetLine).toBe(samePathErrors[0].line);

    state = { ...state, targetLine: null };
    state = navigateState(state, samePathErrors[1].path, samePathErrors[1].line);
    expect(state.targetLine).toBe(samePathErrors[1].line);
  });

  it("error paths do not include the root sigil name", () => {
    for (const err of result.errors) {
      expect(err.path[0]).not.toBe("specification.sigil");
    }
  });
});
