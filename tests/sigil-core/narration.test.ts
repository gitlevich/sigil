import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build } from "../../packages/sigil-core/src/sigilSpace";
import { resolve } from "../../packages/sigil-core/src/narration";
import type { Disturbance } from "../../packages/sigil-core/src/continuousAttention";

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
  };
}

function makeTree(alphaLanguage: string): Sigil {
  return sigil("Root", {
    children: [
      sigil("Alpha", { language: alphaLanguage }),
      sigil("Beta", { language: "I reference @Alpha and @Gamma here." }),
      sigil("Gamma", { language: "I reference @Alpha alone." }),
      sigil("Delta", { language: "No references." }),
    ],
  });
}

describe("Narration", () => {
  describe("resolve", () => {
    it("returns no changes when disturbance is empty", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const disturbance: Disturbance = { displaced: [], total: 0 };
      const result = resolve(space, space, disturbance, "Root");
      expect(result.changes).toEqual([]);
      expect(result.summary).toBe("No structural change.");
    });

    it("describes a new co-occurrence as reference-added", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Gamma and @Delta together."));

      // Delta gained edges it didn't have before
      const disturbance: Disturbance = {
        displaced: [{ name: "Delta", magnitude: 2 }],
        total: 2,
      };
      const result = resolve(before, after, disturbance, "Root");
      const added = result.changes.filter(c => c.kind === "reference-added");
      expect(added.length).toBeGreaterThan(0);
      expect(added[0].description).toContain("Delta");
      expect(added[0].description).toContain("co-occurs");
    });

    it("describes a removed co-occurrence as reference-removed", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta alone now."));

      // Beta-Gamma edge from Alpha's sentence disappeared
      const disturbance: Disturbance = {
        displaced: [{ name: "Beta", magnitude: 1 }, { name: "Gamma", magnitude: 1 }],
        total: 2,
      };
      const result = resolve(before, after, disturbance, "Root");
      const removed = result.changes.filter(c => c.kind === "reference-removed");
      expect(removed.length).toBeGreaterThan(0);
    });

    it("includes focus in summary", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Delta together."));
      const disturbance: Disturbance = {
        displaced: [{ name: "Gamma", magnitude: 1 }],
        total: 1,
      };
      const result = resolve(before, after, disturbance, "Alpha");
      expect(result.summary).toContain("[Alpha]");
      expect(result.focus).toBe("Alpha");
    });

    it("sorts changes by magnitude descending", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Gamma and @Delta together. @Delta and @Beta again."));
      const disturbance: Disturbance = {
        displaced: [
          { name: "Delta", magnitude: 3 },
          { name: "Gamma", magnitude: 1 },
        ],
        total: 4,
      };
      const result = resolve(before, after, disturbance, null);
      for (let i = 1; i < result.changes.length; i++) {
        expect(result.changes[i - 1].magnitude).toBeGreaterThanOrEqual(result.changes[i].magnitude);
      }
    });
  });
});
