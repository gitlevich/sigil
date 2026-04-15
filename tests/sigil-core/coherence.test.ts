import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build } from "../../packages/sigil-core/src/sigilSpace";
import { sense } from "../../packages/sigil-core/src/coherence";

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

describe("Coherence", () => {
  describe("arrives — shape is coherent", () => {
    it("returns arrives when displaced sigils are neighbors of focus", () => {
      const tree = sigil("Root", {
        children: [
          sigil("Alpha", { language: "@Beta and @Gamma together." }),
          sigil("Beta", { language: "@Alpha and @Gamma here." }),
          sigil("Gamma", { language: "@Alpha alone." }),
        ],
      });
      const space = build(tree);
      // Beta and Gamma co-occur with Alpha's neighbors — reachable in 1 hop
      const reading = sense(space, "Alpha", ["Beta", "Gamma"]);
      expect(reading.outcome).toBe("arrives");
      expect(reading.ok).toBe(true);
    });

    it("returns arrives when no displaced sigils", () => {
      const tree = sigil("Root", {
        children: [sigil("Alpha", { language: "Alone." })],
      });
      const space = build(tree);
      const reading = sense(space, "Alpha", []);
      expect(reading.outcome).toBe("arrives");
      expect(reading.ok).toBe(true);
    });

    it("returns arrives for unknown focus", () => {
      const tree = sigil("Root", { children: [] });
      const space = build(tree);
      const reading = sense(space, "NonExistent", ["Alpha"]);
      expect(reading.outcome).toBe("arrives");
      expect(reading.ok).toBe(true);
    });
  });

  describe("loops — attention trapped in a clique", () => {
    it("detects a tightly entangled cluster", () => {
      // A, B, C all mention each other but nothing else
      const tree = sigil("Root", {
        children: [
          sigil("A", { language: "@B and @C together." }),
          sigil("B", { language: "@A and @C together." }),
          sigil("C", { language: "@A and @B together." }),
          sigil("D", { language: "Alone, no references." }),
        ],
      });
      const space = build(tree);
      const reading = sense(space, "A", []);
      expect(reading.outcome).toBe("loops");
      expect(reading.ok).toBe(false);
      expect(reading.reason).toContain("closed cluster");
    });
  });

  describe("veers — narrative drifted", () => {
    it("detects displaced sigils unreachable from focus", () => {
      // Two disconnected clusters: {A,B} and {X,Y}
      const tree = sigil("Root", {
        children: [
          sigil("A", { language: "@B here." }),
          sigil("B", { language: "@A here." }),
          sigil("X", { language: "@Y here." }),
          sigil("Y", { language: "@X here." }),
        ],
      });
      const space = build(tree);
      // Focus on A, but X and Y are displaced — they're in a different cluster
      const reading = sense(space, "A", ["X", "Y"]);
      expect(reading.outcome).toBe("veers");
      expect(reading.ok).toBe(false);
      expect(reading.reason).toContain("unreachable");
    });

    it("does not veer when displaced sigils are within 2 hops", () => {
      // Co-occurrence edges: A↔C (from B), C↔D (from A's second sentence)
      // A's neighbors: {C}. C's neighbors: {A, D}. So D is 2 hops from A.
      const tree = sigil("Root", {
        children: [
          sigil("A", { language: "@B here. @C and @D together." }),
          sigil("B", { language: "@A and @C here." }),
          sigil("C", { language: "Just @B alone." }),
          sigil("D", { language: "Just @A alone." }),
        ],
      });
      const space = build(tree);
      // A's sentence "@C and @D" creates C↔D edge. B's sentence creates A↔C.
      // A's edges: {C} (from B). Hop 1: {A, C}. C's edges: {A (from B), D (from A)}. Hop 2 adds D.
      const reading = sense(space, "A", ["D"]);
      expect(reading.outcome).toBe("arrives");
    });
  });
});
