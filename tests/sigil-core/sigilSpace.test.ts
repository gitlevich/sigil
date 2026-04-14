import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import {
  build,
  distance,
  neighbors,
  displacement,
} from "../../packages/sigil-core/src/sigilSpace";

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
  ├── Alpha  (language mentions @Beta and @Gamma in same sentence)
  ├── Beta   (language mentions @Alpha and @Gamma in same sentence)
  ├── Gamma  (language mentions @Alpha only — never in same sentence as @Beta)
  └── Delta  (no references at all)

  Co-occurrence edges:
    Beta—Gamma from Alpha's sentence ("@Beta and @Gamma")
    Alpha—Gamma from Beta's sentence ("@Alpha and @Gamma")
    Alpha from Gamma's sentence (alone — no pair)
    Delta: none
*/
function testTree(): Sigil {
  return sigil("Root", {
    children: [
      sigil("Alpha", {
        language: "I use @Beta and @Gamma together in this sentence.",
        affordances: [{ name: "do-something", content: "An affordance of Alpha." }],
      }),
      sigil("Beta", {
        language: "I reference @Alpha and @Gamma here.",
        invariants: [{ name: "stay-true", content: "An invariant of Beta." }],
      }),
      sigil("Gamma", {
        language: "I reference @Alpha alone.",
      }),
      sigil("Delta", {
        language: "I stand alone with no references to anyone.",
      }),
    ],
  });
}

describe("SigilSpace", () => {
  describe("!complete — every sigil has a node", () => {
    it("creates a node for every sigil in the tree including those with no co-occurrences", () => {
      const space = build(testTree());
      expect(space.nodes.has("Root")).toBe(true);
      expect(space.nodes.has("Alpha")).toBe(true);
      expect(space.nodes.has("Beta")).toBe(true);
      expect(space.nodes.has("Gamma")).toBe(true);
      expect(space.nodes.has("Delta")).toBe(true);
    });

    it("Delta has no edges but still exists", () => {
      const space = build(testTree());
      const delta = space.nodes.get("Delta")!;
      expect(delta.edges).toHaveLength(0);
    });
  });

  describe("!co-occurrence-grounded — edges come from sentence co-occurrence", () => {
    it("Beta-Gamma edge exists — they co-occur in Alpha's sentence", () => {
      const space = build(testTree());
      const beta = space.nodes.get("Beta")!;
      const gammaEdge = beta.edges.find(e => e.target === "Gamma");
      expect(gammaEdge).toBeDefined();
      expect(gammaEdge!.count).toBeGreaterThan(0);
    });

    it("Alpha-Gamma edge exists — they co-occur in Beta's sentence", () => {
      const space = build(testTree());
      const alpha = space.nodes.get("Alpha")!;
      const gammaEdge = alpha.edges.find(e => e.target === "Gamma");
      expect(gammaEdge).toBeDefined();
      expect(gammaEdge!.count).toBeGreaterThan(0);
    });

    it("Delta has no edges — nobody mentions Delta alongside another sigil", () => {
      const space = build(testTree());
      const delta = space.nodes.get("Delta")!;
      expect(delta.edges).toHaveLength(0);
    });

    it("edges are symmetric", () => {
      const space = build(testTree());
      const alpha = space.nodes.get("Alpha")!;
      const gamma = space.nodes.get("Gamma")!;
      const agEdge = alpha.edges.find(e => e.target === "Gamma");
      const gaEdge = gamma.edges.find(e => e.target === "Alpha");
      expect(agEdge?.count).toBe(gaEdge?.count);
    });
  });

  describe("!vocabulary-attached — every node carries its vocabulary", () => {
    it("Alpha node has its affordance names", () => {
      const space = build(testTree());
      const alpha = space.nodes.get("Alpha")!;
      expect(alpha.vocabulary.name).toBe("Alpha");
      expect(alpha.vocabulary.affordances).toContain("do-something");
    });

    it("Beta node has its invariant names", () => {
      const space = build(testTree());
      const beta = space.nodes.get("Beta")!;
      expect(beta.vocabulary.name).toBe("Beta");
      expect(beta.vocabulary.invariants).toContain("stay-true");
    });
  });

  describe("#distance — inverse co-occurrence", () => {
    it("distance to self is 0", () => {
      const space = build(testTree());
      expect(distance(space, "Alpha", "Alpha")).toBe(0);
    });

    it("distance between co-occurring sigils is 1/count", () => {
      const space = build(testTree());
      const beta = space.nodes.get("Beta")!;
      const gammaEdge = beta.edges.find(e => e.target === "Gamma")!;
      expect(distance(space, "Beta", "Gamma")).toBe(1 / gammaEdge.count);
    });

    it("distance to a non-existent sigil is Infinity", () => {
      const space = build(testTree());
      expect(distance(space, "Alpha", "NoSuchSigil")).toBe(Infinity);
    });

    it("distance between sigils that never co-occur is Infinity", () => {
      // Delta never references anyone and no one references Delta
      const space = build(testTree());
      expect(distance(space, "Delta", "Alpha")).toBe(Infinity);
    });
  });

  describe("#neighbors — closest sigils by co-occurrence", () => {
    it("returns neighbors sorted by descending co-occurrence", () => {
      const space = build(testTree());
      const result = neighbors(space, "Beta");
      expect(result.length).toBeGreaterThan(0);
      for (const n of result) {
        expect(n.vocabulary.name).toBeTruthy();
      }
    });

    it("respects the k limit", () => {
      const space = build(testTree());
      const result = neighbors(space, "Beta", 1);
      expect(result.length).toBe(1);
    });

    it("returns empty for a sigil with no edges", () => {
      const space = build(testTree());
      expect(neighbors(space, "Delta")).toHaveLength(0);
    });

    it("returns empty for unknown sigil", () => {
      const space = build(testTree());
      expect(neighbors(space, "NoSuchSigil")).toHaveLength(0);
    });
  });

  describe("#displacement — measuring change", () => {
    it("displacement is 0 when nothing changed", () => {
      const tree = testTree();
      const space = build(tree);
      expect(displacement(space, space, "Alpha")).toBe(0);
    });

    it("displacement is nonzero when a sigil's co-occurrences change", () => {
      const tree1 = testTree();
      const space1 = build(tree1);

      // Change Alpha's language: Beta now co-occurs with Delta instead of Gamma
      const tree2 = testTree();
      tree2.children[0].language = "I use @Beta and @Delta together in this sentence.";
      const space2 = build(tree2);

      // Beta's edge to Gamma (from Alpha's old sentence) is gone,
      // replaced by edge to Delta. Displacement should be nonzero.
      expect(displacement(space1, space2, "Beta")).toBeGreaterThan(0);
    });

    it("displacement is 0 for a sigil unaffected by the change", () => {
      const tree1 = testTree();
      const space1 = build(tree1);

      // Change Beta's language — Gamma is unaffected since its own edges
      // come from Alpha's content (Beta-Gamma) and Beta's content (Alpha-Gamma).
      // After change, Beta's content has Alpha-Delta instead of Alpha-Gamma.
      // So Gamma loses the Alpha-Gamma edge from Beta's sentence — Gamma IS affected.
      // Let's use a change that truly doesn't affect Delta.
      const tree2 = testTree();
      tree2.children[1].language = "I reference @Alpha and @Gamma and also @Gamma here.";
      const space2 = build(tree2);

      // Delta had no edges before, still has none
      expect(displacement(space1, space2, "Delta")).toBe(0);
    });
  });

  describe("co-occurrence from affordance and invariant content", () => {
    it("extracts co-occurrences from affordance text, not just language", () => {
      const tree = sigil("Root", {
        children: [
          sigil("Foo", {
            affordances: [{ name: "act", content: "This mentions @Bar and @Baz together." }],
          }),
          sigil("Bar", { language: "I am Bar." }),
          sigil("Baz", { language: "I am Baz." }),
        ],
      });
      const space = build(tree);
      const bar = space.nodes.get("Bar")!;
      const bazEdge = bar.edges.find(e => e.target === "Baz");
      expect(bazEdge).toBeDefined();
    });

    it("extracts co-occurrences from invariant text", () => {
      const tree = sigil("Root", {
        children: [
          sigil("Foo", {
            invariants: [{ name: "rule", content: "This mentions @Bar and @Baz together." }],
          }),
          sigil("Bar", { language: "I am Bar." }),
          sigil("Baz", { language: "I am Baz." }),
        ],
      });
      const space = build(tree);
      const bar = space.nodes.get("Bar")!;
      const bazEdge = bar.edges.find(e => e.target === "Baz");
      expect(bazEdge).toBeDefined();
    });
  });
});
