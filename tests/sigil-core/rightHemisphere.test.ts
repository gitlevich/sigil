import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import {
  open,
  focusOn,
  perceive,
  consolidate,
  isRelevant,
} from "../../packages/sigil-core/src/rightHemisphere";
import { build } from "../../packages/sigil-core/src/sigilSpace";

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
  Test tree:

  Root
  ├── Alpha  (mentions @Beta and @Gamma)
  ├── Beta   (mentions @Alpha and @Gamma)
  ├── Gamma  (mentions @Alpha)
  └── Delta  (no references)
*/
function makeTree(alphaLanguage: string): Sigil {
  return sigil("Root", {
    children: [
      sigil("Alpha", {
        language: alphaLanguage,
        invariants: [{ name: "stable", content: "Alpha must be stable." }],
      }),
      sigil("Beta", { language: "I reference @Alpha and @Gamma here." }),
      sigil("Gamma", { language: "I reference @Alpha alone." }),
      sigil("Delta", { language: "No references." }),
    ],
  });
}

describe("RightHemisphere", () => {
  describe("open", () => {
    it("initializes with no focus and empty experience", () => {
      const h = open(makeTree("@Beta and @Gamma together."));
      expect(h.focus).toBeNull();
      expect(h.experience).toEqual([]);
    });
  });

  describe("focusOn", () => {
    it("sets the current focus", () => {
      const h = open(makeTree("@Beta and @Gamma together."));
      const focused = focusOn(h, "Alpha");
      expect(focused.focus).toBe("Alpha");
    });

    it("does not mutate the original", () => {
      const h = open(makeTree("@Beta and @Gamma together."));
      focusOn(h, "Alpha");
      expect(h.focus).toBeNull();
    });
  });

  describe("perceive", () => {
    it("returns no escalation when nothing changed", () => {
      const tree = makeTree("@Beta and @Gamma together.");
      const h = focusOn(open(tree), "Alpha");
      const [perception] = perceive(h, tree, ["Alpha"], 1);
      expect(perception.escalation).toBeNull();
      expect(perception.experience.disturbance.total).toBe(0);
    });

    it("detects disturbance when references change", () => {
      const before = makeTree("@Beta and @Gamma together.");
      const after = makeTree("@Beta and @Delta together.");
      const h = focusOn(open(before), "Alpha");
      const [perception] = perceive(h, after, ["Alpha"], 1);
      expect(perception.experience.disturbance.total).toBeGreaterThan(0);
    });

    it("accumulates experience segments", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Delta together.");
      const tree3 = makeTree("@Beta and @Gamma and @Delta together.");
      let h = focusOn(open(tree1), "Alpha");
      let p;
      [p, h] = perceive(h, tree2, ["Alpha"], 1);
      [p, h] = perceive(h, tree3, ["Alpha"], 2);
      expect(h.experience).toHaveLength(2);
      expect(h.experience[0].timestamp).toBe(1);
      expect(h.experience[1].timestamp).toBe(2);
    });

    it("marks experience as relevant when changed sigil is entangled with focus", () => {
      const before = makeTree("@Beta and @Gamma together.");
      const after = makeTree("@Beta and @Gamma and @Delta together.");
      const h = focusOn(open(before), "Root");
      // Alpha is a child of Root → always relevant
      const [perception] = perceive(h, after, ["Alpha"], 1);
      expect(perception.experience.relevant).toBe(true);
    });

    it("marks experience as not relevant when changed sigil is unentangled", () => {
      const before = makeTree("@Beta and @Gamma together.");
      const after = makeTree("@Beta and @Gamma and @Delta together.");
      // Focus on Delta — Delta has no co-occurrence edges, and Alpha is not its child/parent
      const h = focusOn(open(before), "Delta");
      const [perception] = perceive(h, after, ["Alpha"], 1);
      expect(perception.experience.relevant).toBe(false);
    });

    it("marks not relevant when no focus is set", () => {
      const before = makeTree("@Beta and @Gamma together.");
      const after = makeTree("@Beta and @Delta together.");
      const h = open(before); // no focus
      const [perception] = perceive(h, after, ["Alpha"], 1);
      expect(perception.experience.relevant).toBe(false);
    });
  });

  describe("isRelevant", () => {
    const tree = makeTree("@Beta and @Gamma together.");
    const space = build(tree);

    it("self is always relevant", () => {
      expect(isRelevant(space, "Alpha", "Alpha")).toBe(true);
    });

    it("child is always relevant", () => {
      // Alpha is a child of Root
      expect(isRelevant(space, "Root", "Alpha")).toBe(true);
    });

    it("parent is always relevant", () => {
      // Root is parent of Alpha
      expect(isRelevant(space, "Alpha", "Root")).toBe(true);
    });

    it("neighbor with co-occurrence edge is relevant", () => {
      // Alpha's language "@Beta and @Gamma" creates a Beta↔Gamma edge.
      // Beta's language "@Alpha and @Gamma" creates an Alpha↔Gamma edge.
      // So from Alpha's perspective, Gamma is a neighbor (they co-occur via Beta's sentence).
      expect(isRelevant(space, "Alpha", "Gamma")).toBe(true);
    });

    it("unentangled sigil is not relevant", () => {
      // Delta has no edges, is not parent/child of Alpha
      expect(isRelevant(space, "Alpha", "Delta")).toBe(false);
    });
  });

  describe("consolidate — !single-mechanism", () => {
    it("returns only relevant segments", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Gamma and @Delta together.");
      let h = focusOn(open(tree1), "Root");
      // First change: Alpha changed, Alpha is child of Root → relevant
      let p;
      [p, h] = perceive(h, tree2, ["Alpha"], 1);
      // Second change: pretend Delta changed, Delta is child of Root → relevant
      [p, h] = perceive(h, tree2, ["Delta"], 2);
      // Third: switch focus to Alpha, then change Delta (not entangled with Alpha)
      h = focusOn(h, "Alpha");
      [p, h] = perceive(h, tree2, ["Delta"], 3);
      const consolidated = consolidate(h);
      expect(consolidated).toHaveLength(2);
      expect(consolidated.every(s => s.relevant)).toBe(true);
    });
  });

  describe("!no-escalation — Subconscious never escalates", () => {
    it("consolidate returns segments without escalation signals", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Delta together.");
      let h = focusOn(open(tree1), "Root");
      let p;
      [p, h] = perceive(h, tree2, ["Alpha"], 1);
      const consolidated = consolidate(h);
      // consolidate returns ExperienceSegments, not Escalations
      for (const seg of consolidated) {
        expect(seg).not.toHaveProperty("floor");
      }
    });
  });

  describe("!always-on — no cold start", () => {
    it("first perceive after open produces a valid perception", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Delta together.");
      const h = focusOn(open(tree1), "Alpha");
      const [perception] = perceive(h, tree2, ["Alpha"], 1);
      expect(perception.experience).toBeDefined();
      expect(perception.experience.sigils).toContain("Alpha");
    });
  });
});
