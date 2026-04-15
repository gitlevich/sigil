import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build } from "../../packages/sigil-core/src/sigilSpace";
import {
  buildInvocation,
  renderPrompt,
  parseResponse,
} from "../../packages/sigil-core/src/leftHemisphere";
import type { Resolution } from "../../packages/sigil-core/src/narration";

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

const tree = sigil("Root", {
  children: [
    sigil("Alpha", {
      language: "Alpha uses @Beta and @Gamma together.",
      affordances: [{ name: "do-alpha", content: "does alpha things" }],
      invariants: [{ name: "stay-stable", content: "must remain stable" }],
    }),
    sigil("Beta", { language: "Beta references @Alpha and @Gamma." }),
    sigil("Gamma", { language: "Gamma references @Alpha." }),
  ],
});

const resolution: Resolution = {
  focus: "Alpha",
  changes: [
    { sigil: "Alpha", magnitude: 3, kind: "reference-added", partners: ["Beta"], description: "Alpha now co-occurs with Beta." },
  ],
  summary: "[Alpha] Alpha now co-occurs with Beta.",
};

describe("LeftHemisphere", () => {
  describe("buildInvocation", () => {
    it("builds an invocation with focus vocabulary and scope", () => {
      const space = build(tree);
      const inv = buildInvocation(tree, space, resolution, "Alpha");
      expect(inv).not.toBeNull();
      expect(inv!.focus).toBe("Alpha");
      expect(inv!.vocabulary.name).toBe("Alpha");
      expect(inv!.vocabulary.affordances).toContain("do-alpha");
      expect(inv!.vocabulary.invariants).toContain("stay-stable");
      expect(inv!.language).toContain("@Beta");
    });

    it("includes neighbor vocabularies in scope", () => {
      const space = build(tree);
      const inv = buildInvocation(tree, space, resolution, "Alpha");
      const scopeNames = inv!.scope.map(v => v.name);
      expect(scopeNames.length).toBeGreaterThan(0);
    });

    it("returns null for unknown sigil", () => {
      const space = build(tree);
      expect(buildInvocation(tree, space, resolution, "NonExistent")).toBeNull();
    });
  });

  describe("renderPrompt — !vocabulary-bounded, !stateless", () => {
    it("includes focus name and vocabulary", () => {
      const space = build(tree);
      const inv = buildInvocation(tree, space, resolution, "Alpha")!;
      const prompt = renderPrompt(inv);
      expect(prompt).toContain("Alpha");
      expect(prompt).toContain("do-alpha");
      expect(prompt).toContain("stay-stable");
    });

    it("includes the disturbance summary", () => {
      const space = build(tree);
      const inv = buildInvocation(tree, space, resolution, "Alpha")!;
      const prompt = renderPrompt(inv);
      expect(prompt).toContain("Alpha now co-occurs with Beta");
    });

    it("includes JSON response format instructions", () => {
      const space = build(tree);
      const inv = buildInvocation(tree, space, resolution, "Alpha")!;
      const prompt = renderPrompt(inv);
      expect(prompt).toContain("observation");
      expect(prompt).toContain("suggestions");
      expect(prompt).toContain("needsAttention");
    });
  });

  describe("parseResponse", () => {
    it("parses valid JSON response", () => {
      const response = '{"observation": "The change is significant.", "suggestions": ["Check invariant stay-stable."], "needsAttention": true}';
      const art = parseResponse(response);
      expect(art.observation).toBe("The change is significant.");
      expect(art.suggestions).toEqual(["Check invariant stay-stable."]);
      expect(art.needsAttention).toBe(true);
    });

    it("extracts JSON embedded in prose", () => {
      const response = 'Here is my analysis:\n```json\n{"observation": "Minor shift.", "suggestions": [], "needsAttention": false}\n```';
      const art = parseResponse(response);
      expect(art.observation).toBe("Minor shift.");
      expect(art.needsAttention).toBe(false);
    });

    it("falls back to plain text when JSON is invalid", () => {
      const response = "This is just a plain text observation.";
      const art = parseResponse(response);
      expect(art.observation).toBe("This is just a plain text observation.");
      expect(art.suggestions).toEqual([]);
      expect(art.needsAttention).toBe(false);
    });

    it("handles missing fields gracefully", () => {
      const response = '{"observation": "Something happened."}';
      const art = parseResponse(response);
      expect(art.observation).toBe("Something happened.");
      expect(art.suggestions).toEqual([]);
      expect(art.needsAttention).toBe(false);
    });
  });
});
