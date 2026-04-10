import { describe, it, expect } from "vitest";
import { findContext, buildBreadcrumb, flattenPaths, buildPath, makeSummary } from "../../packages/sigil-core/src/tree";
import type { Sigil } from "../../packages/sigil-core/src/types";

function sigil(name: string, opts?: { language?: string; children?: Sigil[] }): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
  };
}

const tree = sigil("Root", {
  children: [
    sigil("Alpha", {
      children: [sigil("Deep", { language: "deep content" })],
    }),
    sigil("Beta", { language: "beta lang" }),
  ],
});

describe("findContext", () => {
  it("empty path returns root", () => {
    expect(findContext(tree, []).name).toBe("Root");
  });

  it("finds nested child", () => {
    expect(findContext(tree, ["Alpha", "Deep"]).name).toBe("Deep");
  });

  it("invalid segment returns last valid parent", () => {
    expect(findContext(tree, ["Alpha", "Nonexistent"]).name).toBe("Alpha");
  });

  it("completely invalid path returns root", () => {
    expect(findContext(tree, ["ZZZZZ"]).name).toBe("Root");
  });
});

describe("buildBreadcrumb", () => {
  it("valid path produces crumbs", () => {
    const crumbs = buildBreadcrumb(tree, ["Alpha", "Deep"]);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]).toEqual({ name: "Alpha", path: ["Alpha"] });
    expect(crumbs[1]).toEqual({ name: "Deep", path: ["Alpha", "Deep"] });
  });

  it("partial match stops at invalid segment", () => {
    const crumbs = buildBreadcrumb(tree, ["Alpha", "Missing"]);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].name).toBe("Alpha");
  });

  it("empty path produces no crumbs", () => {
    expect(buildBreadcrumb(tree, [])).toHaveLength(0);
  });
});

describe("flattenPaths", () => {
  it("includes root path", () => {
    const paths = flattenPaths(tree, []);
    expect(paths[0]).toEqual([]);
  });

  it("depth-first order", () => {
    const paths = flattenPaths(tree, []);
    const names = paths.map((p) => p[p.length - 1] ?? "Root");
    expect(names).toEqual(["Root", "Alpha", "Deep", "Beta"]);
  });

  it("leaf produces single entry", () => {
    const leaf = sigil("Leaf");
    const paths = flattenPaths(leaf, ["Parent", "Leaf"]);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual(["Parent", "Leaf"]);
  });
});

describe("buildPath", () => {
  it("finds child by name case-insensitive", () => {
    expect(buildPath(tree, "beta", [])).toEqual(["Beta"]);
  });

  it("finds nested child", () => {
    expect(buildPath(tree, "deep", [])).toEqual(["Alpha", "Deep"]);
  });

  it("returns null when not found", () => {
    expect(buildPath(tree, "nonexistent", [])).toBeNull();
  });
});

describe("makeSummary", () => {
  it("strips frontmatter", () => {
    const s = sigil("Test", { language: "---\ntitle: X\n---\nFirst line.\nSecond line." });
    const summary = makeSummary(s);
    expect(summary).toContain("First line.");
    expect(summary).not.toContain("title");
  });

  it("skips heading lines", () => {
    const s = sigil("Test", { language: "# Title\nContent line.\n## Sub\nMore content." });
    const summary = makeSummary(s);
    expect(summary).not.toContain("# Title");
    expect(summary).toContain("Content line.");
    expect(summary).toContain("More content.");
  });

  it("max 3 lines", () => {
    const s = sigil("Test", { language: "A\nB\nC\nD\nE" });
    const lines = makeSummary(s).split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("empty language returns empty", () => {
    expect(makeSummary(sigil("Empty"))).toBe("");
  });
});
