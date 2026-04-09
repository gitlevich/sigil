import { describe, it, expect } from "vitest";
import {
  isInCodeSpan,
  toDashForm,
  findPropSeparator,
  walkTree,
  findContextByPath,
  collectAncestorProperties,
  findAllReferencesInTree,
  resolveChainedRef,
  resolveRefToContext,
  findAffordanceInScopeLocal,
  findInvariantInScopeLocal,
  setEditorContextForTest,
} from "./sigilExtensions";
import type { SigilFolder } from "../../tauri";

// ── Helpers ──

function folder(name: string, opts?: {
  language?: string;
  path?: string;
  children?: SigilFolder[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
}): SigilFolder {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: (opts?.children ?? []) as SigilFolder[],
    path: opts?.path ?? `/mock/${name}`,
    images: [],
  };
}

// ── isInCodeSpan ──

describe("isInCodeSpan", () => {
  it("returns false outside code spans", () => {
    expect(isInCodeSpan("hello @world", 6)).toBe(false);
  });

  it("returns true inside single backtick code span", () => {
    expect(isInCodeSpan("hello `@world` end", 7)).toBe(true);
  });

  it("returns false after closed code span", () => {
    expect(isInCodeSpan("hello `code` @world", 13)).toBe(false);
  });

  it("returns true between nested backticks", () => {
    // Two backticks: first opens, index is inside
    expect(isInCodeSpan("a `b `c", 4)).toBe(true);
  });

  it("returns false at position 0", () => {
    expect(isInCodeSpan("@hello", 0)).toBe(false);
  });
});

// ── toDashForm ──

describe("toDashForm", () => {
  it("replaces spaces with hyphens", () => {
    expect(toDashForm("hello world")).toBe("hello-world");
  });

  it("handles multiple spaces", () => {
    expect(toDashForm("a  b   c")).toBe("a-b-c");
  });

  it("returns unchanged if no spaces", () => {
    expect(toDashForm("already-dashed")).toBe("already-dashed");
  });

  it("handles empty string", () => {
    expect(toDashForm("")).toBe("");
  });
});

// ── findPropSeparator ──

describe("findPropSeparator", () => {
  it("finds # separator", () => {
    expect(findPropSeparator("@Sigil#affordance")).toBe(6);
  });

  it("finds ! separator", () => {
    expect(findPropSeparator("@Sigil!invariant")).toBe(6);
  });

  it("returns -1 when no separator", () => {
    expect(findPropSeparator("@Sigil")).toBe(-1);
  });

  it("handles chained ref with separator", () => {
    expect(findPropSeparator("@Parent@Child#aff")).toBeGreaterThan(0);
  });

  it("returns -1 for empty-ish ref", () => {
    expect(findPropSeparator("@")).toBe(-1);
  });
});

// ── walkTree ──

describe("walkTree", () => {
  const tree = folder("Root", {
    children: [
      folder("Alpha", {
        children: [folder("Deep")],
      }),
      folder("Beta"),
    ],
  });

  it("resolves empty path", () => {
    expect(walkTree([], tree)).toEqual([]);
  });

  it("resolves single segment", () => {
    expect(walkTree(["Alpha"], tree)).toEqual(["Alpha"]);
  });

  it("resolves nested path", () => {
    expect(walkTree(["Alpha", "Deep"], tree)).toEqual(["Alpha", "Deep"]);
  });

  it("returns null for invalid segment", () => {
    expect(walkTree(["Nonexistent"], tree)).toBeNull();
  });

  it("returns null for partially valid path", () => {
    expect(walkTree(["Alpha", "Missing"], tree)).toBeNull();
  });
});

// ── findContextByPath ──

describe("findContextByPath", () => {
  const deep = folder("Deep", { language: "deep content" });
  const alpha = folder("Alpha", { children: [deep] });
  const tree = folder("Root", { children: [alpha, folder("Beta")] });

  it("returns root for empty path", () => {
    expect(findContextByPath([], tree)?.name).toBe("Root");
  });

  it("finds nested context", () => {
    expect(findContextByPath(["Alpha", "Deep"], tree)?.name).toBe("Deep");
  });

  it("returns null for invalid path", () => {
    expect(findContextByPath(["Missing"], tree)).toBeNull();
  });

  it("returns null for partially valid path", () => {
    expect(findContextByPath(["Alpha", "Wrong"], tree)).toBeNull();
  });
});

// ── collectAncestorProperties ──

describe("collectAncestorProperties", () => {
  it("returns empty for null root", () => {
    const result = collectAncestorProperties(null, []);
    expect(result.affordances).toEqual([]);
    expect(result.invariants).toEqual([]);
  });

  it("collects root affordances and invariants", () => {
    const root = folder("Root", {
      affordances: [{ name: "navigate", content: "move around" }],
      invariants: [{ name: "speed", content: "be fast" }],
    });
    const result = collectAncestorProperties(root, []);
    expect(result.affordances).toHaveLength(1);
    expect(result.affordances[0].name).toBe("navigate");
    expect(result.invariants).toHaveLength(1);
    expect(result.invariants[0].name).toBe("speed");
  });

  it("includes sibling properties at each level", () => {
    const child1 = folder("A", {
      affordances: [{ name: "a-aff", content: "" }],
    });
    const child2 = folder("B", {
      affordances: [{ name: "b-aff", content: "" }],
    });
    const root = folder("Root", { children: [child1, child2] });
    // Navigate to A — should also see B's affordances (siblings)
    const result = collectAncestorProperties(root, ["A"]);
    const names = result.affordances.map((a) => a.name);
    expect(names).toContain("a-aff");
    expect(names).toContain("b-aff");
  });

  it("deduplicates by name (first wins)", () => {
    const child = folder("Child", {
      affordances: [{ name: "save", content: "child version" }],
    });
    const root = folder("Root", {
      affordances: [{ name: "save", content: "root version" }],
      children: [child],
    });
    const result = collectAncestorProperties(root, ["Child"]);
    const saveAffs = result.affordances.filter((a) => a.name === "save");
    expect(saveAffs).toHaveLength(1);
    expect(saveAffs[0].content).toBe("root version"); // first wins
  });

  it("walks full path collecting from each ancestor", () => {
    const grandchild = folder("GC", {
      invariants: [{ name: "gc-inv", content: "" }],
    });
    const child = folder("Child", {
      affordances: [{ name: "child-aff", content: "" }],
      children: [grandchild],
    });
    const root = folder("Root", {
      affordances: [{ name: "root-aff", content: "" }],
      children: [child],
    });
    const result = collectAncestorProperties(root, ["Child", "GC"]);
    expect(result.affordances.map((a) => a.name)).toContain("root-aff");
    expect(result.affordances.map((a) => a.name)).toContain("child-aff");
    expect(result.invariants.map((i) => i.name)).toContain("gc-inv");
  });
});

// ── findAllReferencesInTree ──

describe("findAllReferencesInTree", () => {
  it("finds @references in language", () => {
    const tree = folder("Root", {
      language: "The @Observer watches everything.",
      children: [
        folder("Child", { language: "Uses @Observer for tracking." }),
      ],
    });
    const hits = findAllReferencesInTree(tree, "Observer", []);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.contextName === "Root")).toBe(true);
    expect(hits.some((h) => h.contextName === "Child")).toBe(true);
  });

  it("returns empty for no references", () => {
    const tree = folder("Root", { language: "No refs here." });
    expect(findAllReferencesInTree(tree, "Observer", [])).toEqual([]);
  });

  it("skips references inside code spans", () => {
    const tree = folder("Root", { language: "Use `@Observer` in code." });
    const hits = findAllReferencesInTree(tree, "Observer", []);
    expect(hits).toEqual([]);
  });

  it("includes contextPath for nested hits", () => {
    const child = folder("Inner", { language: "@Alpha is used here." });
    const tree = folder("Root", { children: [child] });
    const hits = findAllReferencesInTree(tree, "Alpha", []);
    expect(hits[0].contextPath).toEqual(["Inner"]);
  });
});

// ── resolveChainedRef: global-unique scope kind maps to a valid RefKind ──

describe("resolveChainedRef with global-unique names", () => {
  // Tree:
  //   Root
  //   ├── A        ← we resolve from here
  //   │   └── AChild
  //   └── B
  //       └── BChild
  const tree = folder("Root", {
    children: [
      folder("A", { children: [folder("AChild")] }),
      folder("B", { children: [folder("BChild")] }),
    ],
  });

  it("resolves a globally unique sibling subtree name", () => {
    setEditorContextForTest({
      sigilRoot: tree,
      currentPath: ["A"],
      importedOntologies: null,
      siblings: [],
      siblingNames: [],
    });
    const result = resolveChainedRef("@BChild");
    expect(result.kind).not.toBe("unresolved");
    expect(result.path).toContain("BChild");
  });

  it("does not resolve an ambiguous name globally", () => {
    const ambTree = folder("Root", {
      children: [
        folder("X", { children: [folder("Dup")] }),
        folder("Y", { children: [folder("Dup")] }),
      ],
    });
    setEditorContextForTest({
      sigilRoot: ambTree,
      currentPath: [],
      importedOntologies: null,
      siblings: [],
      siblingNames: [],
    });
    const result = resolveChainedRef("@Dup");
    expect(result.kind).toBe("unresolved");
  });
});

// ══════════════════════════════════════════════════════════════
// Comprehensive scope resolution test suite
//
// Tree used throughout:
//   App (root)
//   ├── Workspace
//   │   ├── Narrating
//   │   │   └── Language
//   │   │       ├── affordance: highlight
//   │   │       └── invariant: clarity
//   │   └── Atlas
//   ├── affordance: navigate
//   ├── affordance: open
//   └── invariant: integrity
//
//   Libs (imported ontology):
//   └── EcoPsych
//       ├── Affordance
//       │   └── affordance: sense
//       └── Invariant
// ══════════════════════════════════════════════════════════════

const langNode = folder("Language", {
  affordances: [{ name: "highlight", content: "highlight refs" }],
  invariants: [{ name: "clarity", content: "must be clear" }],
});
const narratingNode = folder("Narrating", { children: [langNode] });
const atlasNode = folder("Atlas");
const workspaceNode = folder("Workspace", {
  children: [narratingNode, atlasNode],
  affordances: [{ name: "navigate", content: "move around" }, { name: "open", content: "open sigil" }],
  invariants: [{ name: "integrity", content: "never lose work" }],
});
const appRoot = folder("App", { children: [workspaceNode] });

const ecoAffordance = folder("Affordance", {
  affordances: [{ name: "sense", content: "sense the environment" }],
});
const ecoInvariant = folder("Invariant");
const ecoPsych = folder("EcoPsych", { children: [ecoAffordance, ecoInvariant] });
const libs = folder("Libs", { children: [ecoPsych] });

function setupCtx(currentPath: string[], withLibs = false) {
  setEditorContextForTest({
    sigilRoot: appRoot,
    currentPath,
    importedOntologies: withLibs ? libs : null,
    siblings: [],
    siblingNames: [],
    currentContext: findContextByPath(currentPath, appRoot),
  });
}

// ── resolveChainedRef ──

describe("resolveChainedRef — lexical scope", () => {
  it("resolves child by name", () => {
    setupCtx(["Workspace"]);
    expect(resolveChainedRef("@Narrating").kind).not.toBe("unresolved");
  });

  it("resolves neighbor by name", () => {
    setupCtx(["Workspace", "Narrating"]);
    expect(resolveChainedRef("@Atlas").kind).not.toBe("unresolved");
  });

  it("resolves ancestor by name", () => {
    setupCtx(["Workspace", "Narrating", "Language"]);
    expect(resolveChainedRef("@App").kind).not.toBe("unresolved");
  });

  it("resolves globally unique name via proximity", () => {
    setupCtx(["Workspace"]);
    expect(resolveChainedRef("@Language").kind).not.toBe("unresolved");
  });

  it("resolves multi-segment path", () => {
    setupCtx(["Workspace"]);
    expect(resolveChainedRef("@Narrating@Language").kind).not.toBe("unresolved");
  });

  it("resolves lib sigil when ontologies provided", () => {
    setupCtx(["Workspace"], true);
    expect(resolveChainedRef("@EcoPsych").kind).not.toBe("unresolved");
  });
});

// ── resolveRefToContext ──

describe("resolveRefToContext", () => {
  it("returns the resolved SigilFolder", () => {
    setupCtx(["Workspace"]);
    const ctx = resolveRefToContext("@Narrating");
    expect(ctx?.name).toBe("Narrating");
  });

  it("returns null for unresolved ref", () => {
    setupCtx(["Workspace"]);
    expect(resolveRefToContext("@Nonexistent")).toBeNull();
  });

  it("resolves multi-segment ref to context", () => {
    setupCtx(["Workspace"]);
    const ctx = resolveRefToContext("@Narrating@Language");
    expect(ctx?.name).toBe("Language");
  });
});

// ── findAffordanceInScopeLocal ──

describe("findAffordanceInScopeLocal", () => {
  it("finds affordance on current node", () => {
    setupCtx(["Workspace"]);
    expect(findAffordanceInScopeLocal("navigate")).not.toBeNull();
  });

  it("finds affordance on ancestor", () => {
    setupCtx(["Workspace", "Narrating"]);
    expect(findAffordanceInScopeLocal("navigate")).not.toBeNull();
  });

  it("finds affordance on child", () => {
    setupCtx(["Workspace", "Narrating"]);
    expect(findAffordanceInScopeLocal("highlight")).not.toBeNull();
  });

  it("returns null for nonexistent affordance", () => {
    setupCtx(["Workspace"]);
    expect(findAffordanceInScopeLocal("nonexistent")).toBeNull();
  });

  it("finds affordance in imported ontology", () => {
    setupCtx(["Workspace"], true);
    expect(findAffordanceInScopeLocal("sense")).not.toBeNull();
  });

  it("returns null for lib affordance without ontologies", () => {
    setupCtx(["Workspace"], false);
    expect(findAffordanceInScopeLocal("sense")).toBeNull();
  });
});

// ── findInvariantInScopeLocal ──

describe("findInvariantInScopeLocal", () => {
  it("finds invariant on current node", () => {
    setupCtx(["Workspace"]);
    expect(findInvariantInScopeLocal("integrity")).not.toBeNull();
  });

  it("finds invariant on ancestor", () => {
    setupCtx(["Workspace", "Narrating"]);
    expect(findInvariantInScopeLocal("integrity")).not.toBeNull();
  });

  it("finds invariant on child", () => {
    setupCtx(["Workspace", "Narrating"]);
    expect(findInvariantInScopeLocal("clarity")).not.toBeNull();
  });

  it("returns null for nonexistent invariant", () => {
    setupCtx(["Workspace"]);
    expect(findInvariantInScopeLocal("nonexistent")).toBeNull();
  });
});

// ── Qualified ref resolution: @Sigil#affordance ──

describe("qualified ref resolution consistency", () => {
  it("resolveChainedRef resolves @Language (globally unique from Workspace)", () => {
    setupCtx(["Workspace"]);
    const result = resolveChainedRef("@Language");
    expect(result.kind).not.toBe("unresolved");
  });

  it("resolveRefToContext resolves @Language to the Language folder", () => {
    setupCtx(["Workspace"]);
    const ctx = resolveRefToContext("@Language");
    expect(ctx?.name).toBe("Language");
    expect(ctx?.affordances.some(a => a.name === "highlight")).toBe(true);
  });

  // This is the key test: the compiler and editor must agree on @Sigil#affordance
  it("findAffordanceInScopeLocal finds affordance at resolved sigil position", () => {
    // From Language's position, "highlight" is on self — must be findable
    setupCtx(["Workspace", "Narrating", "Language"]);
    expect(findAffordanceInScopeLocal("highlight")).not.toBeNull();
  });
});
