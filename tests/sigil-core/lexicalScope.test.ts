import { describe, it, expect } from "vitest";
import { buildScope, isInScope, resolve } from "../../packages/sigil-core/src/lexicalScope";
import type { Sigil } from "../../packages/sigil-core/src/types";

/** Convenience: resolve and return just the target sigil, or null. */
function resolveTarget(root: Sigil, path: string[], ref: string, libs?: Sigil | null): Sigil | null {
  const r = resolve(root, path, ref, libs);
  return r && !r.ambiguous ? r.target : null;
}

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
  };
}

// ══════════════════════════════════════════════════════════════
// Tree used throughout all tests:
//
//   Root
//   ├── P
//   │   ├── Q              ← we test scope from here
//   │   │   ├── C1
//   │   │   │   └── G
//   │   │   │       └── H
//   │   │   └── C2
//   │   └── N
//   │       └── NChild
//   │           └── NDeep
//   └── Uncle
//       └── Cousin
//
// Imported ontologies (a separate tree, not under Root):
//   Ontologies
//   └── Shapes
//       ├── Circle
//       └── Box
//           └── Corner
// ══════════════════════════════════════════════════════════════

const h = sigil("H");
const g = sigil("G", { children: [h] });
const c1 = sigil("C1", {
  children: [g],
  affordances: [{ name: "spin", content: "spin affordance" }],
  invariants: [{ name: "round", content: "round invariant" }],
});
const c2 = sigil("C2");
const nDeep = sigil("NDeep");
const nChild = sigil("NChild", { children: [nDeep] });
const n = sigil("N", { children: [nChild] });
const q = sigil("Q", { children: [c1, c2] });
const cousin = sigil("Cousin");
const uncle = sigil("Uncle", { children: [cousin] });
const p = sigil("P", { children: [q, n] });
const root = sigil("Root", { children: [p, uncle] });

const corner = sigil("Corner");
const box = sigil("Box", { children: [corner] });
const circle = sigil("Circle");
const shapes = sigil("Shapes", { children: [circle, box] });
const ontologies = sigil("Ontologies", { children: [shapes] });

const here = ["P", "Q"];

// ══════════════════════════════════════════════════════════════
// isInScope — bare name visibility
// ══════════════════════════════════════════════════════════════

describe("isInScope from Q", () => {

  // ── Rule 1: children ──

  it("child C1 is in scope", () => {
    expect(isInScope(root, here, "C1")).toBe(true);
  });

  it("child C2 is in scope", () => {
    expect(isInScope(root, here, "C2")).toBe(true);
  });

  // ── Rule 2: neighbors ──

  it("neighbor N is in scope", () => {
    expect(isInScope(root, here, "N")).toBe(true);
  });

  // ── Rule 3: ancestors ──

  it("parent P is in scope", () => {
    expect(isInScope(root, here, "P")).toBe(true);
  });

  it("root is in scope", () => {
    expect(isInScope(root, here, "Root")).toBe(true);
  });

  it("root resolves from a lower-case @reference", () => {
    const sigilAtlas = sigil("SigilAtlas", { children: [sigil("Sigil")] });
    const result = resolve(sigilAtlas, ["Sigil"], "@sigilatlas");

    expect(result?.target.name).toBe("SigilAtlas");
    expect(result?.path).toEqual([]);
  });

  it("self Q is in scope", () => {
    expect(isInScope(root, here, "Q")).toBe(true);
  });

  // ── Rule 4: imported ontologies ──

  it("Shapes is in scope (imported)", () => {
    expect(isInScope(root, here, "Shapes", ontologies)).toBe(true);
  });

  it("Circle is in scope (child of imported)", () => {
    expect(isInScope(root, here, "Circle", ontologies)).toBe(true);
  });

  it("Corner is in scope (deep in imported)", () => {
    expect(isInScope(root, here, "Corner", ontologies)).toBe(true);
  });

  // ── Rule 5: proximity ──

  it("grandchild G is in scope via proximity (unique in own subtree)", () => {
    expect(isInScope(root, here, "G")).toBe(true);
  });

  it("great-grandchild H is in scope via proximity", () => {
    expect(isInScope(root, here, "H")).toBe(true);
  });

  it("NChild is in scope via proximity (unique in parent's subtree)", () => {
    expect(isInScope(root, here, "NChild")).toBe(true);
  });

  it("Uncle is in scope via proximity (unique in root's subtree)", () => {
    expect(isInScope(root, here, "Uncle")).toBe(true);
  });

  it("Cousin is in scope via proximity (unique in root's subtree)", () => {
    expect(isInScope(root, here, "Cousin")).toBe(true);
  });

  // ── Proximity resolves with correct kind ──

  it("proximity resolution reports kind 'proximity'", () => {
    const r = resolve(root, here, "@G");
    expect(r?.kind).toBe("proximity");
    expect(r?.path).toEqual(["P", "Q", "C1", "G"]);
  });

  // ── Nonexistent ──

  it("Phantom is NOT in scope", () => {
    expect(isInScope(root, here, "Phantom")).toBe(false);
  });

  it("empty reference text does not resolve", () => {
    expect(resolve(root, here, "@")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// Priority: inner scopes win over outer
// ══════════════════════════════════════════════════════════════

describe("priority: innermost wins", () => {
  // Create a tree where the same name appears at multiple levels
  const inner = sigil("Target");
  const s = sigil("S", { children: [inner] });
  const outerTarget = sigil("Target");
  const parent = sigil("Parent", { children: [s, outerTarget] });
  const r = sigil("Root", { children: [parent] });

  it("child wins over sibling", () => {
    const result = resolve(r, ["Parent", "S"], "@Target");
    expect(result?.kind).toBe("contained");
    expect(result?.path).toEqual(["Parent", "S", "Target"]);
  });

  it("imported ontology resolves when there is no local binding", () => {
    const editing = sigil("Editing");
    const app = sigil("Application", { children: [editing] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Editing"], "@Narrative", libs);

    expect(result?.kind).toBe("lib");
    expect(result?.target).toBe(importedNarrative);
    expect(result?.path).toEqual(["AttentionLanguage", "Narrative"]);
  });

  it("local child wins over imported ontology", () => {
    const localNarrative = sigil("Narrative");
    const editing = sigil("Editing", { children: [localNarrative] });
    const app = sigil("Application", { children: [editing] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Editing"], "@Narrative", libs);

    expect(result?.kind).toBe("contained");
    expect(result?.target).toBe(localNarrative);
    expect(result?.path).toEqual(["Application", "Editing", "Narrative"]);
  });

  it("local sibling wins over imported ontology", () => {
    const localNarrative = sigil("Narrative");
    const editing = sigil("Editing");
    const app = sigil("Application", { children: [editing, localNarrative] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Editing"], "@Narrative", libs);

    expect(result?.kind).toBe("sibling");
    expect(result?.target).toBe(localNarrative);
    expect(result?.path).toEqual(["Application", "Narrative"]);
  });

  it("local ancestor wins over imported ontology", () => {
    const editing = sigil("Editing");
    const localNarrative = sigil("Narrative", { children: [editing] });
    const r = sigil("Root", { children: [localNarrative] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Narrative", "Editing"], "@Narrative", libs);

    expect(result?.kind).toBe("ancestor");
    expect(result?.target).toBe(localNarrative);
    expect(result?.path).toEqual(["Narrative"]);
  });

  it("local proximity wins over imported ontology", () => {
    const localNarrative = sigil("Narrative");
    const editing = sigil("Editing");
    const chapter = sigil("Chapter", { children: [editing] });
    const vocabulary = sigil("Vocabulary", { children: [localNarrative] });
    const app = sigil("Application", { children: [chapter, vocabulary] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Chapter", "Editing"], "@Narrative", libs);

    expect(result?.kind).toBe("proximity");
    expect(result?.target).toBe(localNarrative);
    expect(result?.path).toEqual(["Application", "Vocabulary", "Narrative"]);
  });

  it("scope list eclipses imported names with local proximity names", () => {
    const localNarrative = sigil("Narrative");
    const editing = sigil("Editing");
    const chapter = sigil("Chapter", { children: [editing] });
    const vocabulary = sigil("Vocabulary", { children: [localNarrative] });
    const app = sigil("Application", { children: [chapter, vocabulary] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const narrative = buildScope(r, ["Application", "Chapter", "Editing"], libs).find((entry) => entry.name === "Narrative");

    expect(narrative?.kind).toBe("proximity");
    expect(narrative?.target).toBe(localNarrative);
    expect(narrative?.path).toEqual(["Application", "Vocabulary", "Narrative"]);
  });

  it("ambiguous local proximity does not fall through to imported ontology", () => {
    const editing = sigil("Editing");
    const chapter = sigil("Chapter", { children: [editing] });
    const vocabularyA = sigil("VocabularyA", { children: [sigil("Narrative")] });
    const vocabularyB = sigil("VocabularyB", { children: [sigil("Narrative")] });
    const app = sigil("Application", { children: [chapter, vocabularyA, vocabularyB] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Chapter", "Editing"], "@Narrative", libs);

    expect(result?.ambiguous).toBe(true);
    expect(result?.kind).toBe("proximity");
    expect(result?.target).not.toBe(importedNarrative);
  });

  it("multi-segment imported references resolve through imported ontology children", () => {
    const editing = sigil("Editing");
    const app = sigil("Application", { children: [editing] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const attentionLanguage = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Editing"], "@AttentionLanguage@Narrative", libs);

    expect(result?.kind).toBe("lib");
    expect(result?.target).toBe(importedNarrative);
    expect(result?.path).toEqual(["AttentionLanguage", "Narrative"]);
  });

  it("missing imported names stay unresolved instead of inventing a fallback", () => {
    const editing = sigil("Editing");
    const app = sigil("Application", { children: [editing] });
    const r = sigil("Root", { children: [app] });
    const attentionLanguage = sigil("AttentionLanguage", { children: [sigil("Narrative")] });
    const libs = sigil("Imported Ontologies", { children: [attentionLanguage] });

    const result = resolve(r, ["Application", "Editing"], "@Phantom", libs);

    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// Ambiguity detection
// ══════════════════════════════════════════════════════════════

describe("ambiguity detection", () => {

  it("two children with same fuzzy name → ambiguous, does not resolve", () => {
    const a1 = sigil("Widget");
    const a2 = sigil("widget"); // fuzzy matches "Widget"
    const s = sigil("S", { children: [a1, a2] });
    const r = sigil("Root", { children: [s] });

    expect(isInScope(r, ["S"], "Widget")).toBe(false);
    const result = resolve(r, ["S"], "@Widget");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toHaveLength(2);
  });

  it("two siblings with same fuzzy name are ambiguous before imported scope", () => {
    const s = sigil("S");
    const a1 = sigil("Widget");
    const a2 = sigil("widget");
    const parent = sigil("Parent", { children: [s, a1, a2] });
    const r = sigil("Root", { children: [parent] });
    const libs = sigil("Imported Ontologies", { children: [sigil("Shapes", { children: [sigil("Widget")] })] });

    const result = resolve(r, ["Parent", "S"], "@Widget", libs);

    expect(result?.kind).toBe("sibling");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toEqual([
      { name: "Widget", path: ["Parent", "Widget"] },
      { name: "widget", path: ["Parent", "widget"] },
    ]);
  });

  it("two cousins with same name at same proximity level → ambiguous", () => {
    const t1 = sigil("Gadget");
    const t2 = sigil("Gadget");
    const b1 = sigil("B1", { children: [t1] });
    const b2 = sigil("B2", { children: [t2] });
    const s = sigil("S");
    const parent = sigil("Parent", { children: [s, b1, b2] });
    const r = sigil("Root", { children: [parent] });

    // From S, "Gadget" exists in both B1 and B2 — ambiguous at parent's subtree level
    const result = resolve(r, ["Parent", "S"], "@Gadget");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toHaveLength(2);
  });

  it("ambiguous ref does not resolve via resolveRef", () => {
    const a1 = sigil("Thing");
    const a2 = sigil("thing");
    const s = sigil("S", { children: [a1, a2] });
    const r = sigil("Root", { children: [s] });

    expect(resolveTarget(r, ["S"], "@Thing")).toBeNull();
  });

  it("unique name at nearer subtree wins over duplicate at farther level", () => {
    // Gadget is unique in parent's subtree, so it resolves (not ambiguous)
    const gadget = sigil("Gadget");
    const b1 = sigil("B1", { children: [gadget] });
    const s = sigil("S");
    const parent = sigil("Parent", { children: [s, b1] });
    const r = sigil("Root", { children: [parent] });

    const result = resolve(r, ["Parent", "S"], "@Gadget");
    expect(result?.ambiguous).toBeUndefined();
    expect(result?.kind).toBe("proximity");
  });

  it("two imported ontology matches are ambiguous", () => {
    const s = sigil("S");
    const r = sigil("Root", { children: [s] });
    const ontologyA = sigil("OntologyA", { children: [sigil("Narrative")] });
    const ontologyB = sigil("OntologyB", { children: [sigil("Narrative")] });
    const libs = sigil("Imported Ontologies", { children: [ontologyA, ontologyB] });

    const result = resolve(r, ["S"], "@Narrative", libs);

    expect(result?.kind).toBe("lib");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toEqual([
      { name: "Narrative", path: ["OntologyA", "Narrative"] },
      { name: "Narrative", path: ["OntologyB", "Narrative"] },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════
// buildScope — full visible name list
// ══════════════════════════════════════════════════════════════

describe("buildScope", () => {
  it("lists children, siblings, ancestors, proximity names, and imported names in priority order", () => {
    const localLeaf = sigil("LocalLeaf");
    const current = sigil("Current", { children: [localLeaf] });
    const sibling = sigil("Sibling");
    const cousin = sigil("Cousin");
    const branch = sigil("Branch", { children: [current, sibling] });
    const other = sigil("Other", { children: [cousin] });
    const r = sigil("Root", { children: [branch, other] });
    const importedLeaf = sigil("ImportedLeaf");
    const importedOntology = sigil("ImportedOntology", { children: [importedLeaf] });
    const libs = sigil("Imported Ontologies", { children: [importedOntology] });

    const scope = buildScope(r, ["Branch", "Current"], libs);

    expect(scope.map((item) => [item.name, item.kind, item.path])).toEqual([
      ["LocalLeaf", "contained", ["Branch", "Current", "LocalLeaf"]],
      ["Sibling", "sibling", ["Branch", "Sibling"]],
      ["Current", "ancestor", ["Branch", "Current"]],
      ["Branch", "ancestor", ["Branch"]],
      ["Root", "ancestor", []],
      ["Other", "proximity", ["Other"]],
      ["Cousin", "proximity", ["Other", "Cousin"]],
      ["ImportedOntology", "lib", ["ImportedOntology"]],
      ["ImportedLeaf", "lib", ["ImportedOntology", "ImportedLeaf"]],
    ]);
  });

  it("does not add imported names that are shadowed by local names", () => {
    const current = sigil("Current");
    const localNarrative = sigil("Narrative");
    const localAttentionLanguage = sigil("AttentionLanguage");
    const app = sigil("Application", { children: [current, localNarrative, localAttentionLanguage] });
    const r = sigil("Root", { children: [app] });
    const importedNarrative = sigil("Narrative");
    const importedOntology = sigil("AttentionLanguage", { children: [importedNarrative] });
    const libs = sigil("Imported Ontologies", { children: [importedOntology] });

    const scope = buildScope(r, ["Application", "Current"], libs);
    const narrativeItems = scope.filter((item) => item.name === "Narrative");
    const attentionLanguageItems = scope.filter((item) => item.name === "AttentionLanguage");

    expect(narrativeItems).toEqual([
      {
        kind: "sibling",
        name: "Narrative",
        target: localNarrative,
        path: ["Application", "Narrative"],
      },
    ]);
    expect(attentionLanguageItems).toEqual([
      {
        kind: "sibling",
        name: "AttentionLanguage",
        target: localAttentionLanguage,
        path: ["Application", "AttentionLanguage"],
      },
    ]);
  });

  it("skips names that are ambiguous at a proximity level", () => {
    const current = sigil("Current");
    const branch = sigil("Branch", { children: [current] });
    const vocabularyA = sigil("VocabularyA", { children: [sigil("Narrative")] });
    const vocabularyB = sigil("VocabularyB", { children: [sigil("Narrative")] });
    const r = sigil("Root", { children: [branch, vocabularyA, vocabularyB] });

    const scope = buildScope(r, ["Branch", "Current"]);

    expect(scope.some((item) => item.name === "Narrative")).toBe(false);
  });

  it("works at root without siblings or imported ontologies", () => {
    const child = sigil("Child");
    const r = sigil("Root", { children: [child] });

    const scope = buildScope(r, []);

    expect(scope.map((item) => [item.name, item.kind, item.path])).toEqual([
      ["Child", "contained", ["Child"]],
      ["Root", "ancestor", []],
    ]);
  });
});

// ══════════════════════════════════════════════════════════════
// resolveRef — single and multi-segment resolution
// ══════════════════════════════════════════════════════════════

describe("resolveRef from Q", () => {

  it("@C1 resolves (child)", () => {
    expect(resolveTarget(root, here, "@C1")?.name).toBe("C1");
  });

  it("@N resolves (neighbor)", () => {
    expect(resolveTarget(root, here, "@N")?.name).toBe("N");
  });

  it("@P resolves (ancestor)", () => {
    expect(resolveTarget(root, here, "@P")?.name).toBe("P");
  });

  it("@Root resolves (root ancestor)", () => {
    expect(resolveTarget(root, here, "@Root")?.name).toBe("Root");
  });

  // Proximity single-segment
  it("@G resolves via proximity (grandchild)", () => {
    expect(resolveTarget(root, here, "@G")?.name).toBe("G");
  });

  it("@Uncle resolves via proximity", () => {
    expect(resolveTarget(root, here, "@Uncle")?.name).toBe("Uncle");
  });

  // Multi-segment paths
  it("@C1@G resolves (child's child)", () => {
    expect(resolveTarget(root, here, "@C1@G")?.name).toBe("G");
  });

  it("@C1@G@H resolves (arbitrary depth)", () => {
    expect(resolveTarget(root, here, "@C1@G@H")?.name).toBe("H");
  });

  it("@N@NChild resolves (neighbor's child via path)", () => {
    expect(resolveTarget(root, here, "@N@NChild")?.name).toBe("NChild");
  });

  it("@Root@Uncle@Cousin resolves (absolute path through root)", () => {
    expect(resolveTarget(root, here, "@Root@Uncle@Cousin")?.name).toBe("Cousin");
  });

  // Multi-segment: first segment must be in scope
  it("@C1@Nonexistent does NOT resolve", () => {
    expect(resolveTarget(root, here, "@C1@Nonexistent")).toBeNull();
  });

  it("@C1@C2 does NOT resolve (C2 is not a child of C1)", () => {
    expect(resolveTarget(root, here, "@C1@C2")).toBeNull();
  });

  it("@Phantom does NOT resolve", () => {
    expect(resolveTarget(root, here, "@Phantom")).toBeNull();
  });

  // Multi-segment with libs
  it("@Shapes@Circle resolves (lib path)", () => {
    expect(resolveTarget(root, here, "@Shapes@Circle", ontologies)?.name).toBe("Circle");
  });

  it("@Shapes@Box@Corner resolves (deep lib path)", () => {
    expect(resolveTarget(root, here, "@Shapes@Box@Corner", ontologies)?.name).toBe("Corner");
  });
});

// ══════════════════════════════════════════════════════════════
// Scope from different positions
// ══════════════════════════════════════════════════════════════

describe("isInScope from Root (path [])", () => {
  it("child P is in scope", () => {
    expect(isInScope(root, [], "P")).toBe(true);
  });

  it("child Uncle is in scope", () => {
    expect(isInScope(root, [], "Uncle")).toBe(true);
  });

  it("grandchild Q is in scope via proximity", () => {
    expect(isInScope(root, [], "Q")).toBe(true);
  });

  it("Root itself is in scope", () => {
    expect(isInScope(root, [], "Root")).toBe(true);
  });
});

describe("resolveRef from Root (path [])", () => {
  it("@P resolves", () => {
    expect(resolveTarget(root, [], "@P")?.name).toBe("P");
  });

  it("@P@Q resolves via path", () => {
    expect(resolveTarget(root, [], "@P@Q")?.name).toBe("Q");
  });

  it("@Q resolves via proximity (unique in root's subtree)", () => {
    expect(resolveTarget(root, [], "@Q")?.name).toBe("Q");
  });
});

describe("isInScope from C1 (path [P, Q, C1])", () => {
  const fromC1 = ["P", "Q", "C1"];

  it("child G is in scope", () => {
    expect(isInScope(root, fromC1, "G")).toBe(true);
  });

  it("sibling C2 is in scope (neighbor)", () => {
    expect(isInScope(root, fromC1, "C2")).toBe(true);
  });

  it("parent Q is in scope (ancestor)", () => {
    expect(isInScope(root, fromC1, "Q")).toBe(true);
  });

  it("grandparent P is in scope (ancestor)", () => {
    expect(isInScope(root, fromC1, "P")).toBe(true);
  });

  it("Root is in scope (ancestor)", () => {
    expect(isInScope(root, fromC1, "Root")).toBe(true);
  });

  it("N is in scope via proximity (unique in grandparent's subtree)", () => {
    expect(isInScope(root, fromC1, "N")).toBe(true);
  });

  it("Uncle is in scope via proximity (unique in root's subtree)", () => {
    expect(isInScope(root, fromC1, "Uncle")).toBe(true);
  });
});

describe("resolveRef from C1 (path [P, Q, C1])", () => {
  const fromC1 = ["P", "Q", "C1"];

  it("@G resolves (child)", () => {
    expect(resolveTarget(root, fromC1, "@G")?.name).toBe("G");
  });

  it("@G@H resolves (child's child via path)", () => {
    expect(resolveTarget(root, fromC1, "@G@H")?.name).toBe("H");
  });

  it("@C2 resolves (neighbor)", () => {
    expect(resolveTarget(root, fromC1, "@C2")?.name).toBe("C2");
  });

  it("@P@N resolves (P is ancestor, N is child of P)", () => {
    expect(resolveTarget(root, fromC1, "@P@N")?.name).toBe("N");
  });
});

describe("isInScope from N (path [P, N])", () => {
  const fromN = ["P", "N"];

  it("child NChild is in scope", () => {
    expect(isInScope(root, fromN, "NChild")).toBe(true);
  });

  it("neighbor Q is in scope", () => {
    expect(isInScope(root, fromN, "Q")).toBe(true);
  });

  it("ancestor P is in scope", () => {
    expect(isInScope(root, fromN, "P")).toBe(true);
  });

  it("C1 is in scope via proximity (unique in parent's subtree)", () => {
    expect(isInScope(root, fromN, "C1")).toBe(true);
  });
});

describe("resolveRef from N (path [P, N])", () => {
  const fromN = ["P", "N"];

  it("@Q@C1 resolves (neighbor's child via path)", () => {
    expect(resolveTarget(root, fromN, "@Q@C1")?.name).toBe("C1");
  });

  it("@Q@C1@G resolves (neighbor's grandchild via path)", () => {
    expect(resolveTarget(root, fromN, "@Q@C1@G")?.name).toBe("G");
  });

  it("@C1 resolves via proximity", () => {
    expect(resolveTarget(root, fromN, "@C1")?.name).toBe("C1");
  });
});
