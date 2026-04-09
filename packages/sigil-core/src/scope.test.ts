import { describe, it, expect } from "vitest";
import { isInScope, resolveRef } from "./scope";
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

// Current context: Q at path ["P", "Q"]
const here = ["P", "Q"];

// ══════════════════════════════════════════════════════════════
// isInScope — bare name visibility
// ══════════════════════════════════════════════════════════════

describe("isInScope from Q", () => {

  // ── Rule 1: children of S ──

  it("child C1 is in scope", () => {
    expect(isInScope(root, here, "C1")).toBe(true);
  });

  it("child C2 is in scope", () => {
    expect(isInScope(root, here, "C2")).toBe(true);
  });

  // ── Descendants with unique names resolve globally ──

  it("grandchild G IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "G")).toBe(true);
  });

  it("great-grandchild H IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "H")).toBe(true);
  });

  // ── Rule 3: neighbors of S (same level in the hierarchy) ──

  it("neighbor N is in scope", () => {
    expect(isInScope(root, here, "N")).toBe(true);
  });

  it("neighbor's child NChild IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "NChild")).toBe(true);
  });

  it("neighbor's grandchild NDeep IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "NDeep")).toBe(true);
  });

  // ── Rule 4: sigils connecting S to the root ──

  it("parent P is in scope (on path to root)", () => {
    expect(isInScope(root, here, "P")).toBe(true);
  });

  it("root itself is in scope (on path to root)", () => {
    expect(isInScope(root, here, "Root")).toBe(true);
  });

  it("self Q is in scope (on path to root)", () => {
    expect(isInScope(root, here, "Q")).toBe(true);
  });

  // ── NOT in scope: things off the path ──

  // ── Rule 5: globally unique names resolve from anywhere ──

  it("Uncle IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "Uncle")).toBe(true);
  });

  it("Cousin IS in scope (unique name in tree)", () => {
    expect(isInScope(root, here, "Cousin")).toBe(true);
  });

  // ── Rule 5: imported ontologies ──

  it("Shapes is in scope (imported ontology)", () => {
    expect(isInScope(root, here, "Shapes", ontologies)).toBe(true);
  });

  it("Circle is in scope (child of imported ontology)", () => {
    expect(isInScope(root, here, "Circle", ontologies)).toBe(true);
  });

  it("Box is in scope (child of imported ontology)", () => {
    expect(isInScope(root, here, "Box", ontologies)).toBe(true);
  });

  it("Corner is in scope (deep in imported ontology — 'regardless of level')", () => {
    expect(isInScope(root, here, "Corner", ontologies)).toBe(true);
  });

  // ── Nonexistent ──

  it("Phantom is NOT in scope", () => {
    expect(isInScope(root, here, "Phantom")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// resolveRef — single and multi-segment resolution
// ══════════════════════════════════════════════════════════════

describe("resolveRef from Q", () => {

  // ── Single-segment: things in scope ──

  it("@C1 resolves (child)", () => {
    expect(resolveRef(root, here, "@C1")?.name).toBe("C1");
  });

  it("@C2 resolves (child)", () => {
    expect(resolveRef(root, here, "@C2")?.name).toBe("C2");
  });

  it("@N resolves (neighbor)", () => {
    expect(resolveRef(root, here, "@N")?.name).toBe("N");
  });

  it("@P resolves (ancestor)", () => {
    expect(resolveRef(root, here, "@P")?.name).toBe("P");
  });

  it("@Q resolves (self)", () => {
    expect(resolveRef(root, here, "@Q")?.name).toBe("Q");
  });

  it("@Root resolves (root ancestor)", () => {
    expect(resolveRef(root, here, "@Root")?.name).toBe("Root");
  });

  // ── Single-segment: things NOT in scope ──

  it("@G resolves (unique name in tree)", () => {
    expect(resolveRef(root, here, "@G")?.name).toBe("G");
  });

  it("@H resolves (unique name in tree)", () => {
    expect(resolveRef(root, here, "@H")?.name).toBe("H");
  });

  it("@NChild resolves (unique name in tree)", () => {
    expect(resolveRef(root, here, "@NChild")?.name).toBe("NChild");
  });

  it("@Uncle resolves (unique name in tree)", () => {
    expect(resolveRef(root, here, "@Uncle")?.name).toBe("Uncle");
  });

  it("@Cousin resolves (unique name in tree)", () => {
    expect(resolveRef(root, here, "@Cousin")?.name).toBe("Cousin");
  });

  it("@Phantom does NOT resolve", () => {
    expect(resolveRef(root, here, "@Phantom")).toBeNull();
  });

  // ── Multi-segment: Rule 2 — children of children via relative path ──

  it("@C1@G resolves (child's child)", () => {
    expect(resolveRef(root, here, "@C1@G")?.name).toBe("G");
  });

  it("@C1@G@H resolves (child's child's child — arbitrary depth)", () => {
    expect(resolveRef(root, here, "@C1@G@H")?.name).toBe("H");
  });

  it("@N@NChild resolves (neighbor's child via path)", () => {
    expect(resolveRef(root, here, "@N@NChild")?.name).toBe("NChild");
  });

  it("@N@NChild@NDeep resolves (neighbor's grandchild via path)", () => {
    expect(resolveRef(root, here, "@N@NChild@NDeep")?.name).toBe("NDeep");
  });

  it("@P@Q resolves (ancestor's child via path — even though Q is self)", () => {
    expect(resolveRef(root, here, "@P@Q")?.name).toBe("Q");
  });

  it("@P@N resolves (ancestor's other child via path)", () => {
    expect(resolveRef(root, here, "@P@N")?.name).toBe("N");
  });

  it("@Root@P resolves (root's child via path)", () => {
    expect(resolveRef(root, here, "@Root@P")?.name).toBe("P");
  });

  it("@Root@P@Q@C1@G@H resolves (full absolute path from root)", () => {
    expect(resolveRef(root, here, "@Root@P@Q@C1@G@H")?.name).toBe("H");
  });

  it("@Root@Uncle@Cousin resolves (absolute path through root)", () => {
    expect(resolveRef(root, here, "@Root@Uncle@Cousin")?.name).toBe("Cousin");
  });

  // ── Multi-segment: first segment must be in scope ──

  it("@Uncle@Cousin resolves (Uncle is globally unique)", () => {
    expect(resolveRef(root, here, "@Uncle@Cousin")?.name).toBe("Cousin");
  });

  it("@G@H resolves (G is globally unique, H is its child)", () => {
    expect(resolveRef(root, here, "@G@H")?.name).toBe("H");
  });

  it("@NChild@NDeep resolves (NChild is globally unique)", () => {
    expect(resolveRef(root, here, "@NChild@NDeep")?.name).toBe("NDeep");
  });

  // ── Multi-segment: second segment must be a child of first ──

  it("@C1@Nonexistent does NOT resolve", () => {
    expect(resolveRef(root, here, "@C1@Nonexistent")).toBeNull();
  });

  it("@N@Nonexistent does NOT resolve", () => {
    expect(resolveRef(root, here, "@N@Nonexistent")).toBeNull();
  });

  it("@C1@C2 does NOT resolve (C2 is not a child of C1)", () => {
    expect(resolveRef(root, here, "@C1@C2")).toBeNull();
  });

  // ── Multi-segment with libs ──

  it("@Shapes@Circle resolves (lib path)", () => {
    expect(resolveRef(root, here, "@Shapes@Circle", ontologies)?.name).toBe("Circle");
  });

  it("@Shapes@Box@Corner resolves (deep lib path)", () => {
    expect(resolveRef(root, here, "@Shapes@Box@Corner", ontologies)?.name).toBe("Corner");
  });
});

// ══════════════════════════════════════════════════════════════
// Scope from different positions in the tree
// ══════════════════════════════════════════════════════════════

describe("isInScope from Root (path [])", () => {
  it("child P is in scope", () => {
    expect(isInScope(root, [], "P")).toBe(true);
  });

  it("child Uncle is in scope", () => {
    expect(isInScope(root, [], "Uncle")).toBe(true);
  });

  it("grandchild Q IS in scope (unique name in tree)", () => {
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

  it("@Q resolves (unique name in tree)", () => {
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

  it("N IS in scope (unique name in tree)", () => {
    expect(isInScope(root, fromC1, "N")).toBe(true);
  });

  it("Uncle IS in scope (unique name in tree)", () => {
    expect(isInScope(root, fromC1, "Uncle")).toBe(true);
  });

  it("H IS in scope (unique name in tree)", () => {
    expect(isInScope(root, fromC1, "H")).toBe(true);
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

  it("@Q@C2 resolves (ancestor's child via path)", () => {
    expect(resolveRef(root, fromC1, "@Q@C2")?.name).toBe("C2");
  });

  it("@N resolves (unique name in tree)", () => {
    expect(resolveRef(root, fromC1, "@N")?.name).toBe("N");
  });

  it("@Q@N does NOT resolve (N is not a child of Q... wait, it is not)", () => {
    // N is a child of P, not Q. Q's children are C1 and C2.
    expect(resolveRef(root, fromC1, "@Q@N")).toBeNull();
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

  it("Q's child C1 IS in scope (unique name in tree)", () => {
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

  it("@C1 resolves (unique name in tree)", () => {
    expect(resolveRef(root, fromN, "@C1")?.name).toBe("C1");
  });
});

// ══════════════════════════════════════════════════════════════
// Ambiguous names do NOT resolve globally
// ══════════════════════════════════════════════════════════════

describe("ambiguous global names", () => {
  // Tree where "Dup" appears in two places:
  //   AmbRoot
  //   ├── A
  //   │   └── Dup
  //   └── B
  //       └── Dup
  const ambRoot = sigil("AmbRoot", {
    children: [
      sigil("A", { children: [sigil("Dup")] }),
      sigil("B", { children: [sigil("Dup")] }),
    ],
  });

  it("@Dup does NOT resolve when name appears in multiple places", () => {
    expect(resolveRef(ambRoot, ["A"], "@Dup")?.name).toBe("Dup"); // child — lexical scope wins
    expect(resolveRef(ambRoot, [], "@Dup")).toBeNull(); // from root, Dup is ambiguous (not a child of root)
  });

  it("Dup is NOT in scope from root when ambiguous", () => {
    expect(isInScope(ambRoot, [], "Dup")).toBe(false);
  });

  it("Dup IS in scope from A (it's a child — lexical wins before global)", () => {
    expect(isInScope(ambRoot, ["A"], "Dup")).toBe(true);
  });
});
