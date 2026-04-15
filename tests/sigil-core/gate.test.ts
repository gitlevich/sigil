import { describe, it, expect } from "vitest";
import {
  init,
  evaluate,
  step,
  forceYield,
} from "../../packages/sigil-core/src/gate";
import type { Resolution } from "../../packages/sigil-core/src/narration";

const resolution: Resolution = {
  focus: "Root",
  changes: [{
    sigil: "Alpha",
    magnitude: 3,
    kind: "reference-added",
    partners: ["Beta"],
    description: "Alpha now co-occurs with Beta.",
  }],
  summary: "[Root] Alpha now co-occurs with Beta.",
};

describe("Gate", () => {
  describe("evaluate", () => {
    it("passes when coherence is broken and signal is settled", () => {
      const state = init();
      const [decision] = evaluate(state, resolution, 1000, false);
      expect(decision.action).toBe("pass");
      if (decision.action === "pass") {
        expect(decision.resolution).toBe(resolution);
      }
    });

    it("suppresses when coherence is ok — !coherence-precedence", () => {
      const state = init();
      const [decision] = evaluate(state, resolution, 1000, true);
      expect(decision.action).toBe("suppress");
      if (decision.action === "suppress") {
        expect(decision.reason).toContain("coherent");
      }
    });

    it("suppresses rapid flurries — !frequency-filtering", () => {
      let state = init();
      // Three signals in quick succession
      let d;
      [d, state] = evaluate(state, resolution, 1000, false);
      state = forceYield(state); // yield so LH isn't blocking
      [d, state] = evaluate(state, resolution, 1100, false);
      state = forceYield(state);
      [d, state] = evaluate(state, resolution, 1200, false);
      state = forceYield(state);
      // Fourth should be suppressed
      const [decision] = evaluate(state, resolution, 1300, false);
      expect(decision.action).toBe("suppress");
      if (decision.action === "suppress") {
        expect(decision.reason).toContain("flurry");
      }
    });

    it("suppresses when LH is already active — !gate-authority", () => {
      let state = init();
      const [, next] = evaluate(state, resolution, 1000, false);
      // LH is now active
      const [decision] = evaluate(next, resolution, 5000, false);
      expect(decision.action).toBe("suppress");
      if (decision.action === "suppress") {
        expect(decision.reason).toContain("turn");
      }
    });

    it("activates LH on pass", () => {
      const state = init();
      const [, next] = evaluate(state, resolution, 1000, false);
      expect(next.leftHemisphereActive).toBe(true);
      expect(next.turnSteps).toBe(0);
    });
  });

  describe("step — !bounded-turn and !map-check", () => {
    it("continues when coherence improved", () => {
      let state = init();
      let d;
      [d, state] = evaluate(state, resolution, 1000, false);
      const [decision, next] = step(state, true);
      expect(decision.action).toBe("continue");
      expect(next.turnSteps).toBe(1);
    });

    it("yields when coherence did not improve — !map-check", () => {
      let state = init();
      let d;
      [d, state] = evaluate(state, resolution, 1000, false);
      const [decision, next] = step(state, false);
      expect(decision.action).toBe("yield");
      expect(next.leftHemisphereActive).toBe(false);
    });

    it("yields at turn cap — !bounded-turn", () => {
      let state = init();
      let d;
      [d, state] = evaluate(state, resolution, 1000, false);
      // Take 5 steps (the cap)
      for (let i = 0; i < 4; i++) {
        let td;
        [td, state] = step(state, true);
        expect(td.action).toBe("continue");
      }
      const [decision, next] = step(state, true);
      expect(decision.action).toBe("yield");
      expect(decision.reason).toContain("cap");
      expect(next.leftHemisphereActive).toBe(false);
    });

    it("yields when no active turn", () => {
      const state = init();
      const [decision] = step(state, true);
      expect(decision.action).toBe("yield");
    });
  });

  describe("forceYield", () => {
    it("deactivates LH", () => {
      let state = init();
      let d;
      [d, state] = evaluate(state, resolution, 1000, false);
      expect(state.leftHemisphereActive).toBe(true);
      state = forceYield(state);
      expect(state.leftHemisphereActive).toBe(false);
    });
  });
});
