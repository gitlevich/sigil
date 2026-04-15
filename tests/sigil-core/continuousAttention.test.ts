import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build } from "../../packages/sigil-core/src/sigilSpace";
import {
  init,
  attend,
  noiseFloor,
  crosses,
} from "../../packages/sigil-core/src/continuousAttention";
import type { Watch } from "../../packages/sigil-core/src/continuousAttention";

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

describe("ContinuousAttention", () => {
  describe("init", () => {
    it("creates a watch with empty history", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const watch = init(space);
      expect(watch.previous).toBe(space);
      expect(watch.history).toEqual([]);
    });
  });

  describe("attend", () => {
    it("returns zero disturbance when nothing changed", () => {
      const tree = makeTree("@Beta and @Gamma together.");
      const space = build(tree);
      const watch = init(space);
      const [disturbance] = attend(watch, space);
      expect(disturbance.total).toBe(0);
      expect(disturbance.displaced).toEqual([]);
    });

    it("detects displacement when a reference is added", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Gamma and @Delta together."));
      const watch = init(before);
      const [disturbance] = attend(watch, after);
      expect(disturbance.total).toBeGreaterThan(0);
      const names = disturbance.displaced.map(d => d.name);
      expect(names).toContain("Delta");
    });

    it("detects displacement when a reference is removed", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta alone now."));
      const watch = init(before);
      const [disturbance] = attend(watch, after);
      expect(disturbance.total).toBeGreaterThan(0);
      const names = disturbance.displaced.map(d => d.name);
      expect(names).toContain("Gamma");
    });

    it("returns zero when text changes but references stay the same", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta plus @Gamma in one place."));
      const watch = init(before);
      const [disturbance] = attend(watch, after);
      expect(disturbance.total).toBe(0);
    });

    it("sorts displaced sigils by magnitude descending", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      // Add Delta co-occurring with Beta, Gamma, AND add a new sentence
      const after = build(makeTree("@Beta and @Gamma and @Delta together. @Delta and @Beta again."));
      const watch = init(before);
      const [disturbance] = attend(watch, after);
      for (let i = 1; i < disturbance.displaced.length; i++) {
        expect(disturbance.displaced[i - 1].magnitude)
          .toBeGreaterThanOrEqual(disturbance.displaced[i].magnitude);
      }
    });

    it("advances the watch state — previous becomes current", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Delta together."));
      const watch = init(before);
      const [, nextWatch] = attend(watch, after);
      expect(nextWatch.previous).toBe(after);
    });

    it("appends total to history", () => {
      const before = build(makeTree("@Beta and @Gamma together."));
      const after = build(makeTree("@Beta and @Delta together."));
      const watch = init(before);
      const [disturbance, nextWatch] = attend(watch, after);
      expect(nextWatch.history).toEqual([disturbance.total]);
    });
  });

  describe("noiseFloor", () => {
    it("returns minimum floor when history is empty", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const watch = init(space);
      expect(noiseFloor(watch)).toBe(1);
    });

    it("returns median of history", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const watch: Watch = { previous: space, history: [2, 10, 4, 8, 6] };
      // sorted: [2, 4, 6, 8, 10] → median = 6
      expect(noiseFloor(watch)).toBe(6);
    });

    it("handles even-length history", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const watch: Watch = { previous: space, history: [2, 4, 6, 8] };
      // sorted: [2, 4, 6, 8] → median = (4+6)/2 = 5
      expect(noiseFloor(watch)).toBe(5);
    });

    it("never drops below minimum", () => {
      const space = build(makeTree("@Beta and @Gamma together."));
      const watch: Watch = { previous: space, history: [0, 0, 0] };
      expect(noiseFloor(watch)).toBe(1);
    });
  });

  describe("crosses", () => {
    it("returns true when total exceeds floor", () => {
      expect(crosses({ displaced: [], total: 5 }, 3)).toBe(true);
    });

    it("returns false when total equals floor", () => {
      expect(crosses({ displaced: [], total: 3 }, 3)).toBe(false);
    });

    it("returns false when total is below floor", () => {
      expect(crosses({ displaced: [], total: 1 }, 3)).toBe(false);
    });
  });

  describe("!semantic-stability — rewording without structural change", () => {
    it("produces zero disturbance for pure paraphrase", () => {
      const before = build(makeTree("@Beta and @Gamma are entangled here."));
      const after = build(makeTree("In this sentence, @Gamma co-occurs with @Beta."));
      const watch = init(before);
      const [disturbance] = attend(watch, after);
      expect(disturbance.total).toBe(0);
    });
  });

  describe("!conceptual-salience — structural break ranks higher than surface edit", () => {
    it("removing a reference produces disturbance; rewording does not", () => {
      const original = build(makeTree("@Beta and @Gamma together."));

      // Surface rewrite — same references
      const reworded = build(makeTree("@Beta alongside @Gamma, same meaning."));
      const watch1 = init(original);
      const [surfaceDisturbance] = attend(watch1, reworded);

      // Structural break — remove Gamma
      const broken = build(makeTree("@Beta alone now."));
      const watch2 = init(original);
      const [structuralDisturbance] = attend(watch2, broken);

      expect(surfaceDisturbance.total).toBe(0);
      expect(structuralDisturbance.total).toBeGreaterThan(0);
    });
  });
});
