import { describe, it, expect } from "vitest";
import {
  extractFrontmatterField,
  collectFrontmatterKeys,
  collectFrontmatterValues,
  getFrontMatterEnd,
} from "./sigilExtensions";
import type { SigilFolder } from "../../tauri";

function folder(name: string, opts?: { language?: string; path?: string; children?: SigilFolder[] }): SigilFolder {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: (opts?.children ?? []) as SigilFolder[],
    path: opts?.path ?? `/mock/${name}`,
    images: [],
  };
}

describe("extractFrontmatterField", () => {
  it("extracts status", () => {
    expect(extractFrontmatterField("---\nstatus: done\n---\nBody", "status")).toBe("done");
  });

  it("extracts type", () => {
    expect(extractFrontmatterField("---\nstatus: idea\ntype: implementation\n---\nBody", "type")).toBe("implementation");
  });

  it("returns null for missing key", () => {
    expect(extractFrontmatterField("---\nstatus: idea\n---\nBody", "type")).toBeNull();
  });

  it("returns null when no frontmatter", () => {
    expect(extractFrontmatterField("Just plain text", "status")).toBeNull();
  });

  it("returns null when frontmatter not closed", () => {
    expect(extractFrontmatterField("---\nstatus: idea\nNo closing", "status")).toBeNull();
  });

  it("handles multiple fields", () => {
    const content = "---\nstatus: active\ntype: conceptual\npriority: high\n---\nBody";
    expect(extractFrontmatterField(content, "status")).toBe("active");
    expect(extractFrontmatterField(content, "type")).toBe("conceptual");
    expect(extractFrontmatterField(content, "priority")).toBe("high");
  });

  it("ignores empty value", () => {
    expect(extractFrontmatterField("---\nstatus: \n---\nBody", "status")).toBeNull();
  });
});

describe("collectFrontmatterKeys", () => {
  it("collects keys from single node", () => {
    const tree = folder("Root", { language: "---\nstatus: idea\ntype: conceptual\n---\n" });
    const keys = collectFrontmatterKeys(tree);
    expect(keys).toContain("status");
    expect(keys).toContain("type");
  });

  it("collects keys from children", () => {
    const child = folder("Child", { language: "---\npriority: high\n---\n" });
    const tree = folder("Root", { language: "---\nstatus: idea\n---\n", children: [child] });
    const keys = collectFrontmatterKeys(tree);
    expect(keys).toContain("status");
    expect(keys).toContain("priority");
  });

  it("returns empty for no frontmatter", () => {
    const tree = folder("Root", { language: "No frontmatter here" });
    expect(collectFrontmatterKeys(tree)).toEqual([]);
  });
});

describe("collectFrontmatterValues", () => {
  it("collects distinct values for a key", () => {
    const child1 = folder("A", { path: "/a", language: "---\nstatus: done\n---\n" });
    const child2 = folder("B", { path: "/b", language: "---\nstatus: active\n---\n" });
    const tree = folder("Root", { path: "/root", language: "---\nstatus: idea\n---\n", children: [child1, child2] });
    const values = collectFrontmatterValues("status", tree, "/excluded");
    expect(values).toContain("idea");
    expect(values).toContain("done");
    expect(values).toContain("active");
  });

  it("excludes current context", () => {
    const child = folder("A", { path: "/a", language: "---\nstatus: done\n---\n" });
    const tree = folder("Root", { path: "/root", language: "---\nstatus: idea\n---\n", children: [child] });
    const values = collectFrontmatterValues("status", tree, "/root");
    expect(values).not.toContain("idea");
    expect(values).toContain("done");
  });

  it("returns empty for missing key", () => {
    const tree = folder("Root", { path: "/root", language: "---\nstatus: idea\n---\n" });
    expect(collectFrontmatterValues("type", tree, "/excluded")).toEqual([]);
  });
});

describe("getFrontMatterEnd", () => {
  function makeDoc(lines: string[]) {
    return {
      lines: lines.length,
      line: (n: number) => ({ text: lines[n - 1], from: 0, to: lines[n - 1].length }),
    };
  }

  it("finds closing delimiter", () => {
    expect(getFrontMatterEnd(makeDoc(["---", "status: idea", "---", "body"]))).toBe(3);
  });

  it("returns -1 when no opening", () => {
    expect(getFrontMatterEnd(makeDoc(["no frontmatter", "just text"]))).toBe(-1);
  });

  it("returns -1 when no closing", () => {
    expect(getFrontMatterEnd(makeDoc(["---", "status: idea", "no closing"]))).toBe(-1);
  });

  it("returns -1 for single line doc", () => {
    expect(getFrontMatterEnd(makeDoc(["---"]))).toBe(-1);
  });
});
