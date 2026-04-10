import { describe, it, expect } from "vitest";
import { computeWeight, maxDepth, squarify, depthStyle } from "../../packages/sigil-core/src/treemap";
import type { Sigil } from "../../packages/sigil-core/src/types";
import type { WeightedItem, Rect } from "../../packages/sigil-core/src/treemap";

function sigil(name: string, children: Sigil[] = []): Sigil {
  return { name, language: "", affordances: [], invariants: [], children };
}

describe("computeWeight", () => {
  it("leaf weighs 1", () => {
    expect(computeWeight(sigil("A"))).toBe(1);
  });

  it("parent weighs 1 + children", () => {
    const tree = sigil("Root", [sigil("A"), sigil("B")]);
    expect(computeWeight(tree)).toBe(3);
  });

  it("nested tree counts all descendants", () => {
    const tree = sigil("Root", [
      sigil("A", [sigil("A1"), sigil("A2")]),
      sigil("B"),
    ]);
    expect(computeWeight(tree)).toBe(5);
  });
});

describe("maxDepth", () => {
  it("leaf has depth 0", () => {
    expect(maxDepth(sigil("A"))).toBe(0);
  });

  it("single level children gives depth 1", () => {
    expect(maxDepth(sigil("Root", [sigil("A")]))).toBe(1);
  });

  it("nested tree returns max depth", () => {
    const tree = sigil("Root", [
      sigil("A", [sigil("A1", [sigil("A1a")])]),
      sigil("B"),
    ]);
    expect(maxDepth(tree)).toBe(3);
  });
});

describe("squarify", () => {
  const rect: Rect = { x: 0, y: 0, w: 100, h: 100 };

  it("empty items returns empty", () => {
    expect(squarify([], rect)).toEqual([]);
  });

  it("single item fills entire rect", () => {
    const items: WeightedItem[] = [{ ctx: sigil("A"), weight: 1 }];
    const result = squarify(items, rect);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].w).toBe(100);
    expect(result[0].h).toBe(100);
  });

  it("multiple items cover full area", () => {
    const items: WeightedItem[] = [
      { ctx: sigil("A"), weight: 3 },
      { ctx: sigil("B"), weight: 2 },
      { ctx: sigil("C"), weight: 1 },
    ];
    const result = squarify(items, rect);
    expect(result).toHaveLength(3);
    const totalArea = result.reduce((s, r) => s + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(10000, 1);
  });

  it("no rectangles overlap", () => {
    const items: WeightedItem[] = [
      { ctx: sigil("A"), weight: 4 },
      { ctx: sigil("B"), weight: 3 },
      { ctx: sigil("C"), weight: 2 },
      { ctx: sigil("D"), weight: 1 },
    ];
    const result = squarify(items, rect);
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
        const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
        if (overlapX && overlapY) {
          // Allow tiny floating-point overlap
          const overlapArea =
            Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
            Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          expect(overlapArea).toBeLessThan(0.01);
        }
      }
    }
  });

  it("all weights zero returns empty", () => {
    const items: WeightedItem[] = [
      { ctx: sigil("A"), weight: 0 },
      { ctx: sigil("B"), weight: 0 },
    ];
    expect(squarify(items, rect)).toEqual([]);
  });

  it("wide rect splits horizontally", () => {
    const wideRect: Rect = { x: 0, y: 0, w: 200, h: 50 };
    const items: WeightedItem[] = [
      { ctx: sigil("A"), weight: 1 },
      { ctx: sigil("B"), weight: 1 },
    ];
    const result = squarify(items, wideRect);
    expect(result).toHaveLength(2);
    // In a wide rect, items should be laid out side by side
    expect(result[0].w).toBeLessThan(200);
  });
});

describe("depthStyle", () => {
  it("light mode root is lighter than leaf", () => {
    const root = depthStyle(0, 3, false);
    const leaf = depthStyle(3, 3, false);
    // hsl(0, 0%, XX%) — extract the last percentage (lightness)
    const rootL = parseInt(root.background.match(/(\d+)%\)$/)?.[1] ?? "0");
    const leafL = parseInt(leaf.background.match(/(\d+)%\)$/)?.[1] ?? "0");
    expect(rootL).toBeGreaterThan(leafL);
  });

  it("dark mode root is darker than leaf", () => {
    const root = depthStyle(0, 3, true);
    const leaf = depthStyle(3, 3, true);
    const rootL = parseInt(root.background.match(/(\d+)%\)$/)?.[1] ?? "100");
    const leafL = parseInt(leaf.background.match(/(\d+)%\)$/)?.[1] ?? "0");
    expect(rootL).toBeLessThan(leafL);
  });

  it("text color contrasts with background", () => {
    const light = depthStyle(0, 3, false);
    expect(light.color).toContain("10%"); // dark text on light bg
    const dark = depthStyle(0, 3, true);
    expect(dark.color).toContain("90%"); // light text on dark bg
  });

  it("handles zero totalDepth", () => {
    const style = depthStyle(0, 0, false);
    expect(style.background).toContain("hsl");
  });
});
