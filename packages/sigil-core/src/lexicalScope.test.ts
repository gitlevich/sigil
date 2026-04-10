import { describe, it, expect } from "vitest";
import { isInScope, resolveRef, resolveRefFull } from "./lexicalScope";
import type { Sigil } from "./types";

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
    const r = resolveRefFull(root, here, "@G");
    expect(r?.kind).toBe("proximity");
    expect(r?.path).toEqual(["P", "Q", "C1", "G"]);
  });

  // ── Nonexistent ──

  it("Phantom is NOT in scope", () => {
    expect(isInScope(root, here, "Phantom")).toBe(false);
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
    const result = resolveRefFull(r, ["Parent", "S"], "@Target");
    expect(result?.kind).toBe("contained");
    expect(result?.path).toEqual(["Parent", "S", "Target"]);
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
    const result = resolveRefFull(r, ["S"], "@Widget");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toHaveLength(2);
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
    const result = resolveRefFull(r, ["Parent", "S"], "@Gadget");
    expect(result?.ambiguous).toBe(true);
    expect(result?.candidates).toHaveLength(2);
  });

  it("ambiguous ref does not resolve via resolveRef", () => {
    const a1 = sigil("Thing");
    const a2 = sigil("thing");
    const s = sigil("S", { children: [a1, a2] });
    const r = sigil("Root", { children: [s] });

    expect(resolveRef(r, ["S"], "@Thing")).toBeNull();
  });

  it("unique name at nearer subtree wins over duplicate at farther level", () => {
    // Gadget is unique in parent's subtree, so it resolves (not ambiguous)
    const gadget = sigil("Gadget");
    const b1 = sigil("B1", { children: [gadget] });
    const s = sigil("S");
    const parent = sigil("Parent", { children: [s, b1] });
    const r = sigil("Root", { children: [parent] });

    const result = resolveRefFull(r, ["Parent", "S"], "@Gadget");
    expect(result?.ambiguous).toBeUndefined();
    expect(result?.kind).toBe("proximity");
  });
});

// ══════════════════════════════════════════════════════════════
// resolveRef — single and multi-segment resolution
// ══════════════════════════════════════════════════════════════

describe("resolveRef from Q", () => {

  it("@C1 resolves (child)", () => {
    expect(resolveRef(root, here, "@C1")?.name).toBe("C1");
  });

  it("@N resolves (neighbor)", () => {
    expect(resolveRef(root, here, "@N")?.name).toBe("N");
  });

  it("@P resolves (ancestor)", () => {
    expect(resolveRef(root, here, "@P")?.name).toBe("P");
  });

  it("@Root resolves (root ancestor)", () => {
    expect(resolveRef(root, here, "@Root")?.name).toBe("Root");
  });

  // Proximity single-segment
  it("@G resolves via proximity (grandchild)", () => {
    expect(resolveRef(root, here, "@G")?.name).toBe("G");
  });

  it("@Uncle resolves via proximity", () => {
    expect(resolveRef(root, here, "@Uncle")?.name).toBe("Uncle");
  });

  // Multi-segment paths
  it("@C1@G resolves (child's child)", () => {
    expect(resolveRef(root, here, "@C1@G")?.name).toBe("G");
  });

  it("@C1@G@H resolves (arbitrary depth)", () => {
    expect(resolveRef(root, here, "@C1@G@H")?.name).toBe("H");
  });

  it("@N@NChild resolves (neighbor's child via path)", () => {
    expect(resolveRef(root, here, "@N@NChild")?.name).toBe("NChild");
  });

  it("@Root@Uncle@Cousin resolves (absolute path through root)", () => {
    expect(resolveRef(root, here, "@Root@Uncle@Cousin")?.name).toBe("Cousin");
  });

  // Multi-segment: first segment must be in scope
  it("@C1@Nonexistent does NOT resolve", () => {
    expect(resolveRef(root, here, "@C1@Nonexistent")).toBeNull();
  });

  it("@C1@C2 does NOT resolve (C2 is not a child of C1)", () => {
    expect(resolveRef(root, here, "@C1@C2")).toBeNull();
  });

  it("@Phantom does NOT resolve", () => {
    expect(resolveRef(root, here, "@Phantom")).toBeNull();
  });

  // Multi-segment with libs
  it("@Shapes@Circle resolves (lib path)", () => {
    expect(resolveRef(root, here, "@Shapes@Circle", ontologies)?.name).toBe("Circle");
  });

  it("@Shapes@Box@Corner resolves (deep lib path)", () => {
    expect(resolveRef(root, here, "@Shapes@Box@Corner", ontologies)?.name).toBe("Corner");
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
    expect(resolveRef(root, [], "@P")?.name).toBe("P");
  });

  it("@P@Q resolves via path", () => {
    expect(resolveRef(root, [], "@P@Q")?.name).toBe("Q");
  });

  it("@Q resolves via proximity (unique in root's subtree)", () => {
    expect(resolveRef(root, [], "@Q")?.name).toBe("Q");
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
    expect(resolveRef(root, fromC1, "@G")?.name).toBe("G");
  });

  it("@G@H resolves (child's child via path)", () => {
    expect(resolveRef(root, fromC1, "@G@H")?.name).toBe("H");
  });

  it("@C2 resolves (neighbor)", () => {
    expect(resolveRef(root, fromC1, "@C2")?.name).toBe("C2");
  });

  it("@P@N resolves (P is ancestor, N is child of P)", () => {
    expect(resolveRef(root, fromC1, "@P@N")?.name).toBe("N");
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
    expect(resolveRef(root, fromN, "@Q@C1")?.name).toBe("C1");
  });

  it("@Q@C1@G resolves (neighbor's grandchild via path)", () => {
    expect(resolveRef(root, fromN, "@Q@C1@G")?.name).toBe("G");
  });

  it("@C1 resolves via proximity", () => {
    expect(resolveRef(root, fromN, "@C1")?.name).toBe("C1");
  });
});
