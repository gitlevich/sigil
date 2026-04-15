import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build } from "../../packages/sigil-core/src/sigilSpace";
import {
  perceiveLocal,
  perceiveShape,
  diffShape,
} from "../../packages/sigil-core/src/shapePerception";

function sigil(name: string, opts?: {
  language?: string;
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  children?: Sigil[];
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

/*
  Well-woven tree: parent describes itself using children,
  children reference each other in their language.

  BicameralMind
  ├── RightHemisphere  (mentions @LeftHemisphere, @CorpusCallosum)
  ├── LeftHemisphere   (mentions @RightHemisphere, @CorpusCallosum)
  └── CorpusCallosum   (mentions @RightHemisphere, @LeftHemisphere)
*/
function wellWovenTree(): Sigil {
  return sigil("BicameralMind", {
    language: "My @RightHemisphere sees. My @LeftHemisphere articulates. The @CorpusCallosum connects them.",
    children: [
      sigil("RightHemisphere", {
        language: "I sense the shape. When discomfort crosses threshold, @CorpusCallosum carries it to @LeftHemisphere.",
      }),
      sigil("LeftHemisphere", {
        language: "I receive from @CorpusCallosum what @RightHemisphere sensed. I articulate.",
      }),
      sigil("CorpusCallosum", {
        language: "I compress what @RightHemisphere emits and gate what @LeftHemisphere receives.",
      }),
    ],
  });
}

/*
  Poorly woven tree: parent doesn't mention its children,
  children reference external things instead of each other.

  Container
  ├── Foo  (mentions @External only)
  ├── Bar  (mentions @External only)
  └── Baz  (mentions nothing)
*/
function poorlyWovenTree(): Sigil {
  return sigil("Container", {
    language: "This container holds things. It references @External which doesn't exist here.",
    children: [
      sigil("Foo", { language: "I only care about @External stuff." }),
      sigil("Bar", { language: "I also reference @External and nothing else." }),
      sigil("Baz", { language: "I stand alone mentioning nobody." }),
    ],
  });
}

describe("ShapePerception", () => {
  describe("perceiveLocal — shape of a single sigil", () => {
    it("well-woven sigil has high weave, low leakage, high grounding", () => {
      const tree = wellWovenTree();
      const space = build(tree);
      const shape = perceiveLocal(tree, space, 0);

      // All 3 children reference each other — weave should be 1.0
      expect(shape.weave).toBe(1);
      // All edges are between siblings — leakage should be 0
      expect(shape.leakage).toBe(0);
      // Parent mentions all 3 children — grounding should be 1.0
      expect(shape.grounding).toBe(1);
      expect(shape.orphans).toHaveLength(0);
    });

    it("poorly woven sigil has low weave, high leakage, low grounding", () => {
      const tree = poorlyWovenTree();
      const space = build(tree);
      const shape = perceiveLocal(tree, space, 0);

      // Children never reference each other — weave should be 0
      expect(shape.weave).toBe(0);
      // Baz is an orphan — no edges at all to siblings
      expect(shape.orphans).toContain("Baz");
      // Parent doesn't mention its children
      expect(shape.grounding).toBe(0);
    });

    it("detects sufficiency gaps — referenced names with no sigil", () => {
      const tree = poorlyWovenTree();
      const space = build(tree);
      const shape = perceiveLocal(tree, space, 0);

      // @External is referenced but has no sigil
      expect(shape.gaps).toContain("External");
    });

    it("a leaf has perfect shape — nothing to be wrong about", () => {
      const tree = sigil("Leaf", { language: "I am simple." });
      const space = build(tree);
      const shape = perceiveLocal(tree, space, 0);

      expect(shape.weave).toBe(1);
      expect(shape.leakage).toBe(0);
      expect(shape.grounding).toBe(1);
      expect(shape.orphans).toHaveLength(0);
    });

    it("partially woven sigil gets fractional weave", () => {
      // A has 3 children. Two reference each other, one doesn't.
      // Parent mentions each child in separate sentences to avoid
      // creating co-occurrence between them at the parent level.
      const tree = sigil("A", {
        language: "@X is one. @Y is another. @Z is the third.",
        children: [
          sigil("X", { language: "I mention @Y here." }),
          sigil("Y", { language: "I mention @X here." }),
          sigil("Z", { language: "I mention nobody sibling." }),
        ],
      });
      const space = build(tree);
      const shape = perceiveLocal(tree, space, 0);

      // 3 children → 3 possible edges (X-Y, X-Z, Y-Z). Only X-Y exists.
      expect(shape.weave).toBeCloseTo(1 / 3, 2);
      expect(shape.orphans).toContain("Z");
      expect(shape.orphans).not.toContain("X");
      expect(shape.orphans).not.toContain("Y");
    });
  });

  describe("perceiveShape — full tree reading", () => {
    it("reads every sigil in the tree", () => {
      const tree = wellWovenTree();
      const space = build(tree);
      const reading = perceiveShape(tree, space);

      expect(reading.shapes.has("BicameralMind")).toBe(true);
      expect(reading.shapes.has("RightHemisphere")).toBe(true);
      expect(reading.shapes.has("LeftHemisphere")).toBe(true);
      expect(reading.shapes.has("CorpusCallosum")).toBe(true);
    });

    it("well-woven tree has high average weave and low average leakage", () => {
      const tree = wellWovenTree();
      const space = build(tree);
      const reading = perceiveShape(tree, space);

      expect(reading.averageWeave).toBeGreaterThan(0.8);
      expect(reading.averageLeakage).toBe(0);
    });

    it("poorly woven tree has low average weave", () => {
      const tree = poorlyWovenTree();
      const space = build(tree);
      const reading = perceiveShape(tree, space);

      expect(reading.averageWeave).toBeLessThan(0.2);
      expect(reading.totalGaps).toBeGreaterThan(0);
    });

    it("records depth correctly through the hierarchy", () => {
      const tree = sigil("Root", {
        children: [
          sigil("Mid", {
            language: "@Deep is below me.",
            children: [
              sigil("Deep", { language: "I am at depth 2." }),
            ],
          }),
        ],
      });
      const space = build(tree);
      const reading = perceiveShape(tree, space);

      expect(reading.shapes.get("Root")!.depth).toBe(0);
      expect(reading.shapes.get("Mid")!.depth).toBe(1);
      expect(reading.shapes.get("Deep")!.depth).toBe(2);
    });
  });

  describe("diffShape — perceiving change", () => {
    it("detects weave improvement when children become entangled", () => {
      const before = sigil("A", {
        children: [
          sigil("X", { language: "I stand alone." }),
          sigil("Y", { language: "I also stand alone." }),
        ],
      });
      const after = sigil("A", {
        children: [
          sigil("X", { language: "I now mention @Y." }),
          sigil("Y", { language: "I now mention @X." }),
        ],
      });

      const spaceBefore = build(before);
      const spaceAfter = build(after);
      const readingBefore = perceiveShape(before, spaceBefore);
      const readingAfter = perceiveShape(after, spaceAfter);

      const shifts = diffShape(readingBefore, readingAfter);
      const aShift = shifts.find(s => s.name === "A");
      expect(aShift).toBeDefined();
      expect(aShift!.weaveChange).toBeGreaterThan(0); // weave improved
    });

    it("detects new sufficiency gaps", () => {
      const before = sigil("A", {
        language: "I reference @X.",
        children: [sigil("X", { language: "Hello." })],
      });
      const after = sigil("A", {
        language: "I reference @X and @Missing.",
        children: [sigil("X", { language: "Hello." })],
      });

      const readingBefore = perceiveShape(before, build(before));
      const readingAfter = perceiveShape(after, build(after));

      const shifts = diffShape(readingBefore, readingAfter);
      const aShift = shifts.find(s => s.name === "A");
      expect(aShift).toBeDefined();
      expect(aShift!.newGaps).toContain("Missing");
    });

    it("detects when a gap is filled", () => {
      const before = sigil("A", {
        language: "I reference @X and @Y.",
        children: [sigil("X", { language: "Hello." })],
        // Y doesn't exist — it's a gap
      });
      const after = sigil("A", {
        language: "I reference @X and @Y.",
        children: [
          sigil("X", { language: "Hello." }),
          sigil("Y", { language: "I now exist." }),
        ],
      });

      const readingBefore = perceiveShape(before, build(before));
      const readingAfter = perceiveShape(after, build(after));

      const shifts = diffShape(readingBefore, readingAfter);
      const aShift = shifts.find(s => s.name === "A");
      expect(aShift).toBeDefined();
      expect(aShift!.filledGaps).toContain("Y");
    });

    it("detects when a child becomes orphaned", () => {
      const before = sigil("A", {
        children: [
          sigil("X", { language: "I mention @Y." }),
          sigil("Y", { language: "I mention @X." }),
        ],
      });
      const after = sigil("A", {
        children: [
          sigil("X", { language: "I mention nobody now." }),
          sigil("Y", { language: "I also mention nobody." }),
        ],
      });

      const readingBefore = perceiveShape(before, build(before));
      const readingAfter = perceiveShape(after, build(after));

      const shifts = diffShape(readingBefore, readingAfter);
      const aShift = shifts.find(s => s.name === "A");
      expect(aShift).toBeDefined();
      expect(aShift!.newOrphans.length).toBeGreaterThan(0);
    });

    it("returns empty when nothing changed", () => {
      const tree = wellWovenTree();
      const space = build(tree);
      const reading = perceiveShape(tree, space);
      const shifts = diffShape(reading, reading);
      expect(shifts).toHaveLength(0);
    });
  });
});
