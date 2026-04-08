import { describe, it, expect } from "vitest";
import { buildLexicalScope, flattenOntologyRefs } from "./lexicalScope";
import type { SigilFolder } from "../../tauri";

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

// ── Fixtures ──

const grandchild = makeFolder("Grandchild", [], "# Grandchild");
const childA = makeFolder("ChildA", [grandchild], "# ChildA");
const childB = makeFolder("ChildB", [], "# ChildB");
const parent = makeFolder("Parent", [childA, childB], "# Parent");
const root = makeFolder("App", [parent], "# App");

const libConcept1 = makeFolder("Concept1", [], "# Concept1");
const libConcept2 = makeFolder("Concept2", [], "# Concept2");
const libRoot = makeFolder("AttentionLanguage", [libConcept1, libConcept2], "# Attention Language");

describe("buildLexicalScope", () => {
  it("includes children as contained refs", () => {
    const refs = buildLexicalScope(root, ["Parent"]);
    const contained = refs.filter(r => r.kind === "contained");
    expect(contained.map(r => r.name)).toEqual(["ChildA", "ChildB"]);
  });

  it("includes siblings and ancestors", () => {
    const refs = buildLexicalScope(root, ["Parent", "ChildA"]);
    const names = refs.map(r => r.name);
    expect(names).toContain("Grandchild"); // contained child
    expect(names).toContain("ChildA");     // self (sibling of parent's children)
    expect(names).toContain("ChildB");     // sibling
    expect(names).toContain("Parent");     // ancestor
    expect(names).toContain("App");        // root
  });

  it("absolute paths are relative to scope root by default", () => {
    const refs = buildLexicalScope(root, ["Parent", "ChildA"]);
    const grandchildRef = refs.find(r => r.name === "Grandchild");
    expect(grandchildRef?.absolutePath).toEqual(["Parent", "ChildA", "Grandchild"]);

    const childBRef = refs.find(r => r.name === "ChildB");
    expect(childBRef?.absolutePath).toEqual(["Parent", "ChildB"]);
  });

  it("pathPrefix is prepended to all absolute paths", () => {
    const prefix = ["Imported Ontologies"];
    const refs = buildLexicalScope(libRoot, ["Concept1"], prefix);

    const concept1 = refs.find(r => r.name === "Concept1");
    expect(concept1?.absolutePath).toEqual(["Imported Ontologies", "Concept1"]);

    const concept2 = refs.find(r => r.name === "Concept2");
    expect(concept2?.absolutePath).toEqual(["Imported Ontologies", "Concept2"]);

    const libRootRef = refs.find(r => r.name === "AttentionLanguage");
    expect(libRootRef?.absolutePath).toEqual(["Imported Ontologies"]);
  });

  it("without prefix, lib refs lack Imported Ontologies prefix (the bug)", () => {
    // This test documents the pre-fix behavior: without prefix, paths are wrong
    const refs = buildLexicalScope(libRoot, ["Concept1"]);
    const concept2 = refs.find(r => r.name === "Concept2");
    // Without prefix, absolutePath is just ["Concept2"] — missing "Imported Ontologies"
    expect(concept2?.absolutePath).toEqual(["Concept2"]);
  });

  it("with prefix, lib refs include Imported Ontologies prefix (the fix)", () => {
    const refs = buildLexicalScope(libRoot, ["Concept1"], ["Imported Ontologies"]);
    const concept2 = refs.find(r => r.name === "Concept2");
    expect(concept2?.absolutePath).toEqual(["Imported Ontologies", "Concept2"]);
  });

  it("still builds scope for invalid path (findContext returns last valid node)", () => {
    // findContext returns root when path segment is not found
    const refs = buildLexicalScope(root, ["Nonexistent"]);
    expect(refs.length).toBeGreaterThan(0);
  });

  it("deduplicates by name", () => {
    const refs = buildLexicalScope(root, ["Parent", "ChildA"]);
    const names = refs.map(r => r.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("child shadows sibling with same name (innermost wins)", () => {
    // Parent has children: ChildA, ChildB
    // ChildA has a child also named "ChildB" — it should shadow the sibling
    const innerChildB = makeFolder("ChildB", [], "# Inner ChildB");
    const childAWithShadow = makeFolder("ChildA", [innerChildB], "# ChildA");
    const outerChildB = makeFolder("ChildB", [], "# Outer ChildB");
    const parentWithShadow = makeFolder("Parent", [childAWithShadow, outerChildB], "# Parent");
    const rootWithShadow = makeFolder("App", [parentWithShadow], "# App");

    const refs = buildLexicalScope(rootWithShadow, ["Parent", "ChildA"]);
    const childBRef = refs.find(r => r.name === "ChildB");
    expect(childBRef).toBeDefined();
    // The contained (inner) child wins, not the sibling
    expect(childBRef!.kind).toBe("contained");
    expect(childBRef!.absolutePath).toEqual(["Parent", "ChildA", "ChildB"]);
  });

  it("child shadows ancestor with same name (innermost wins)", () => {
    const innerParent = makeFolder("Parent", [], "# Inner Parent");
    const childWithShadow = makeFolder("ChildA", [innerParent], "# ChildA");
    const parentOuter = makeFolder("Parent", [childWithShadow], "# Parent");
    const rootWithShadow = makeFolder("App", [parentOuter], "# App");

    const refs = buildLexicalScope(rootWithShadow, ["Parent", "ChildA"]);
    const parentRef = refs.find(r => r.name === "Parent");
    expect(parentRef).toBeDefined();
    expect(parentRef!.kind).toBe("contained");
    expect(parentRef!.absolutePath).toEqual(["Parent", "ChildA", "Parent"]);
  });
});

describe("flattenOntologyRefs", () => {
  it("flattens children with correct absolute paths", () => {
    const seen = new Set<string>();
    const refs = flattenOntologyRefs(libRoot, ["Imported Ontologies", "AttentionLanguage"], seen, "AttentionLanguage");
    expect(refs.map(r => r.name)).toEqual(["Concept1", "Concept2"]);
    expect(refs[0].absolutePath).toEqual(["Imported Ontologies", "AttentionLanguage", "Concept1"]);
    expect(refs[0].libPrefix).toBe("AttentionLanguage");
  });

  it("skips already-seen names", () => {
    const seen = new Set(["Concept1"]);
    const refs = flattenOntologyRefs(libRoot, ["Imported Ontologies", "AttentionLanguage"], seen, "AttentionLanguage");
    expect(refs.map(r => r.name)).toEqual(["Concept2"]);
  });
});
