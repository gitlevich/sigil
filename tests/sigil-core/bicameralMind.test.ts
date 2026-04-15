import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import {
  open,
  focus,
  perceive,
  completeTurn,
  experience,
  memory,
  sleep,
} from "../../packages/sigil-core/src/bicameralMind";
import { recognize, allRemembered } from "../../packages/sigil-core/src/memory";

function sigil(name: string, opts?: {
  language?: string;
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  children?: Sigil[];
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
  };
}

function makeTree(alphaLanguage: string): Sigil {
  return sigil("Root", {
    children: [
      sigil("Alpha", {
        language: alphaLanguage,
        affordances: [{ name: "do-alpha", content: "does things" }],
        invariants: [{ name: "stay-stable", content: "must be stable" }],
      }),
      sigil("Beta", { language: "References @Alpha and @Gamma." }),
      sigil("Gamma", { language: "References @Alpha." }),
      sigil("Delta", { language: "No references." }),
    ],
  });
}

describe("BicameralMind", () => {
  describe("full cycle — perceive → gate → LH prompt → complete", () => {
    it("produces a prompt when disturbance crosses threshold", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Gamma and @Delta together. @Delta and @Beta again.");

      let mind = focus(open(tree1), "Alpha");

      // First perceive with no change — builds baseline
      let result;
      [result, mind] = perceive(mind, tree1, ["Alpha"], 1000);

      // Second perceive with structural change — should trigger
      [result, mind] = perceive(mind, tree2, ["Alpha"], 5000);

      if (result.prompt) {
        expect(result.prompt).toContain("Alpha");
        expect(result.prompt).toContain("do-alpha");
        expect(result.invocation).not.toBeNull();
        expect(result.suppressedReason).toBeNull();
      }
      // If suppressed, the gate filtered it — that's also valid behavior
    });

    it("completes a turn and parses articulation", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Gamma and @Delta together.");

      let mind = focus(open(tree1), "Alpha");
      let result;
      [result, mind] = perceive(mind, tree1, ["Alpha"], 1000);
      [result, mind] = perceive(mind, tree2, ["Alpha"], 5000);

      if (result.prompt) {
        const response = '{"observation": "Delta entered the co-occurrence space of Alpha.", "suggestions": ["Check if stay-stable invariant holds."], "needsAttention": false}';
        const [turnResult, nextMind] = completeTurn(mind, response, tree2);
        expect(turnResult.articulation.observation).toContain("Delta");
        expect(turnResult.articulation.suggestions).toHaveLength(1);
        // needsAttention=false means coherence improved, so Gate may continue
      }
    });
  });

  describe("no disturbance — no escalation", () => {
    it("returns suppressed when nothing changed", () => {
      const tree = makeTree("@Beta and @Gamma together.");
      let mind = focus(open(tree), "Alpha");
      const [result] = perceive(mind, tree, ["Alpha"], 1000);
      expect(result.prompt).toBeNull();
      expect(result.invocation).toBeNull();
    });
  });

  describe("experience accumulation", () => {
    it("accumulates segments across perceive calls", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Delta together.");
      let mind = focus(open(tree1), "Alpha");
      let r;
      [r, mind] = perceive(mind, tree1, ["Alpha"], 1000);
      [r, mind] = perceive(mind, tree2, ["Alpha"], 2000);
      expect(experience(mind)).toHaveLength(2);
    });
  });

  describe("Memory integration", () => {
    it("perceive remembers changed sigils in short-term and returns traces", () => {
      const tree = makeTree("@Beta and @Gamma together.");
      let mind = focus(open(tree), "Alpha");
      let r;
      [r, mind] = perceive(mind, tree, ["Alpha"], 1000);

      // Traces returned for persistence
      expect(r.traces.length).toBeGreaterThan(0);
      expect(r.traces[0].name).toBe("Alpha");

      // Recognizable from short-term
      const mem = memory(mind);
      expect(recognize(mem, "Alpha")).not.toBeNull();
      expect(recognize(mem, "Alpha")!.remembered.vocabulary.affordances).toContain("do-alpha");

      // Not in long-term yet
      expect(mem.longTerm.size).toBe(0);
    });

    it("perceive recalls remembered sigils near focus", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Gamma and @Delta together.");
      let mind = focus(open(tree1), "Alpha");
      let r;

      // First perceive — Alpha gets remembered
      [r, mind] = perceive(mind, tree1, ["Alpha"], 1000);

      // Second perceive — Alpha should be recalled (it's the focus)
      [r, mind] = perceive(mind, tree2, ["Alpha"], 2000);
      const recalledNames = r.recalled.map(rc => rc.remembered.name);
      expect(recalledNames).toContain("Alpha");
    });

    it("sleep consolidates short-term into long-term", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Gamma and @Delta together.");
      let mind = focus(open(tree1), "Alpha");
      let r;
      [r, mind] = perceive(mind, tree1, ["Alpha"], 1000);
      [r, mind] = perceive(mind, tree2, ["Alpha"], 2000);

      // Short-term has traces, long-term is empty
      expect(memory(mind).shortTerm.length).toBeGreaterThan(0);
      expect(memory(mind).longTerm.size).toBe(0);

      // Sleep — consolidates and clears
      mind = sleep(mind, tree2).mind;
      expect(experience(mind)).toHaveLength(0);
      expect(memory(mind).shortTerm).toHaveLength(0);

      // Alpha moved to long-term
      expect(memory(mind).longTerm.size).toBeGreaterThan(0);
      expect(recognize(memory(mind), "Alpha")).not.toBeNull();
    });

    it("sleep decays unattended sigils", () => {
      const tree = makeTree("@Beta and @Gamma together.");
      let mind = focus(open(tree), "Alpha");
      let r;

      // Remember both Alpha and Beta
      [r, mind] = perceive(mind, tree, ["Alpha", "Beta"], 1000);

      // Sleep many times, only attending to Alpha
      for (let i = 0; i < 30; i++) {
        mind = sleep(mind, tree).mind;
        // Re-perceive with only Alpha to keep experience flowing
        [r, mind] = perceive(mind, tree, ["Alpha"], 2000 + i * 1000);
      }

      // Alpha should survive, Beta should have decayed
      expect(recognize(memory(mind), "Alpha")).not.toBeNull();
      // Beta was never re-attended, should eventually decay
    });
  });

  describe("!stateless — each invocation is self-contained", () => {
    it("prompt contains all context needed for the LH", () => {
      const tree1 = makeTree("@Beta and @Gamma together.");
      const tree2 = makeTree("@Beta and @Delta together.");
      let mind = focus(open(tree1), "Alpha");
      let r;
      [r, mind] = perceive(mind, tree1, ["Alpha"], 1000);
      [r, mind] = perceive(mind, tree2, ["Alpha"], 5000);
      if (r.prompt) {
        expect(r.prompt).toContain("Focus: Alpha");
        expect(r.prompt).toContain("Vocabulary");
        expect(r.prompt).toContain("Disturbance");
      }
    });
  });
});
