import { describe, it, expect } from "vitest";
import { buildLexicalScope, flattenOntologyRefs } from "./lexicalScope";
import type { SigilFolder } from "../../tauri";

function makeFolder(name: string, children: SigilFolder[] = [], language = ""): SigilFolder {
  return { name, path: `/mock/${name}`, language, affordances: [], invariants: [], children, images: [], isImported: false };
}

describe("buildLexicalScope edge cases", () => {
  it("root navigation (empty path) includes children as contained and root as sibling", () => {
    const root = makeFolder("Root", [makeFolder("Alpha", [], "# alpha")], "# root");
    const refs = buildLexicalScope(root, []);
    expect(refs.find(r => r.name === "Alpha")?.kind).toBe("contained");
    expect(refs.find(r => r.name === "Root")?.kind).toBe("sibling");
  });

  it("applies pathPrefix to all absolute paths", () => {
    const root = makeFolder("Root", [makeFolder("Child", [], "# child")]);
    const refs = buildLexicalScope(root, [], ["Imported Ontologies"]);
    expect(refs.find(r => r.name === "Child")?.absolutePath).toEqual(["Imported Ontologies", "Child"]);
  });

  it("deduplicates names (first wins)", () => {
    const grandchild = makeFolder("Alpha", [], "# grand");
    const alpha = makeFolder("Alpha", [grandchild], "# alpha");
    const root = makeFolder("Root", [alpha], "# root");
    const refs = buildLexicalScope(root, ["Alpha"]);
    expect(refs.filter(r => r.name === "Alpha")).toHaveLength(1);
  });
});

describe("flattenOntologyRefs edge cases", () => {
  it("recursively flattens 3+ levels deep", () => {
    const deep = makeFolder("DeepChild", [], "# deep");
    const mid = makeFolder("MidChild", [deep], "# mid");
    const lib = makeFolder("Lib", [mid], "# lib");
    const seen = new Set<string>();
    const refs = flattenOntologyRefs(lib, ["Libs", "Lib"], seen, "Lib");
    expect(refs.map(r => r.name)).toEqual(["MidChild", "DeepChild"]);
    expect(refs[0].absolutePath).toEqual(["Libs", "Lib", "MidChild"]);
    expect(refs[1].absolutePath).toEqual(["Libs", "Lib", "MidChild", "DeepChild"]);
    expect(refs.every(r => r.libPrefix === "Lib")).toBe(true);
  });

  it("returns empty for ontology with no children", () => {
    expect(flattenOntologyRefs(makeFolder("Empty"), ["Libs", "Empty"], new Set(), "Empty")).toEqual([]);
  });
});
