import { describe, expect, it } from "vitest";
import type { Idea, SigilFolder } from "../src/tauri";
import type { WorkspaceState } from "../src/state/WorkspaceContext";
import { graftDirtyPendingBuffer, isVisionPath } from "../src/workspaceReload";

function makeFolder(
  name: string,
  path: string,
  language: string,
  children: SigilFolder[] = [],
): SigilFolder {
  return {
    name,
    path,
    language,
    affordances: [],
    invariants: [],
    children,
    images: [],
  };
}

function makeSpec(vision: string, root: SigilFolder): Idea {
  return {
    name: root.name,
    rootPath: "/project",
    vision,
    root,
  };
}

function makeState(spec: Idea, currentPath: string[] = []): WorkspaceState {
  return {
    spec,
    currentPath,
    history: [],
    collapsedPaths: [],
    targetLine: null,
    conflict: null,
    mergeViewOpen: false,
  };
}

describe("workspace reload grafting", () => {
  it("recognizes the root vision path exactly", () => {
    expect(isVisionPath("/project", "/project/vision.md")).toBe(true);
    expect(isVisionPath("/project", "/project/Child/vision.md")).toBe(false);
    expect(isVisionPath("/project", "/project/language.md")).toBe(false);
  });

  it("preserves dirty vision content during a disk reload", () => {
    const currentRoot = makeFolder("Project", "/project", "local root language");
    const diskRoot = makeFolder("Project", "/project", "disk root language");
    const current = makeState(makeSpec("draft vision", currentRoot));
    const diskSpec = makeSpec("disk vision", diskRoot);

    const next = graftDirtyPendingBuffer(
      diskSpec,
      current,
      "/project/vision.md",
      "draft vision",
      true,
      currentRoot,
      [],
    );

    expect(next.vision).toBe("draft vision");
    expect(next.root.language).toBe("disk root language");
  });

  it("lets clean vision reloads adopt disk content", () => {
    const root = makeFolder("Project", "/project", "root language");
    const current = makeState(makeSpec("current vision", root));
    const diskSpec = makeSpec("disk vision", root);

    const next = graftDirtyPendingBuffer(
      diskSpec,
      current,
      "/project/vision.md",
      "current vision",
      false,
      root,
      [],
    );

    expect(next).toBe(diskSpec);
  });

  it("keeps preserving dirty language content during a disk reload", () => {
    const currentChild = makeFolder("Child", "/project/Child", "local child language");
    const currentRoot = makeFolder("Project", "/project", "local root language", [currentChild]);
    const diskChild = makeFolder("Child", "/project/Child", "disk child language");
    const diskRoot = makeFolder("Project", "/project", "disk root language", [diskChild]);
    const current = makeState(makeSpec("current vision", currentRoot), ["Child"]);
    const diskSpec = makeSpec("disk vision", diskRoot);

    const next = graftDirtyPendingBuffer(
      diskSpec,
      current,
      "/project/Child/language.md",
      "local child language",
      true,
      currentChild,
      ["Child"],
    );

    expect(next.vision).toBe("disk vision");
    expect(next.root.children[0]?.language).toBe("local child language");
  });
});
