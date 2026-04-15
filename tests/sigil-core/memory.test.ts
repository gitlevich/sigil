/**
 * Memory tests — spec invariants as assertions.
 *
 * !geometric-storage — every remembered sigil has position + vocabulary
 * !reliable — recognized while reinforced through use
 * !lossy — unreinforced sigils fade through passive decay
 * !vocabulary-retrieval — recognition returns full vocabulary
 * !co-occurrence-merge — always-co-occurring sigils merge
 * !passive-decay — weight decays without reinforcement
 * !adaptive-familiarity — repeated encounter strengthens, irrelevance fades
 */
import { describe, it, expect } from "vitest";
import { build } from "sigil-core/sigilSpace";
import type { SigilNode } from "sigil-core/sigilSpace";
import type { Sigil } from "sigil-core/types";
import {
  init,
  remember,
  recognize,
  recall,
  consolidate,
  allRemembered,
  serializeTrace,
  parseTrace,
  serializeLongTerm,
  parseLongTerm,
} from "sigil-core/memory";

// ── Helpers ──

function makeSigil(name: string, language: string, children: Sigil[] = []): Sigil {
  return { name, language, affordances: [], invariants: [], children };
}

function makeRoot(...children: Sigil[]): Sigil {
  return {
    name: "Root",
    language: children.map(c => `@${c.name}`).join(" and ") + " are here.",
    affordances: [],
    invariants: [],
    children,
  };
}

function nodeFrom(space: ReturnType<typeof build>, name: string): SigilNode {
  const node = space.nodes.get(name);
  if (!node) throw new Error(`No node ${name} in space`);
  return node;
}

/** Convenience: remember and discard the trace. */
function rem(mem: ReturnType<typeof init>, node: SigilNode, ts: number) {
  const [next] = remember(mem, node, ts);
  return next;
}

// ── Tests ──

describe("Memory", () => {
  describe("short-term / long-term split", () => {
    it("remember writes to short-term, not long-term", () => {
      const root = makeRoot(makeSigil("A", "uses @B"), makeSigil("B", ""));
      const space = build(root);
      const [mem, trace] = remember(init(), nodeFrom(space, "A"), 1000);

      expect(mem.shortTerm).toHaveLength(1);
      expect(mem.longTerm.size).toBe(0);
      expect(trace.name).toBe("A");
    });

    it("consolidate merges short-term into long-term and clears short-term", () => {
      const root = makeRoot(makeSigil("A", ""), makeSigil("B", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);

      mem = consolidate(mem, ["A"], space, 2000);

      expect(mem.shortTerm).toHaveLength(0);
      expect(mem.longTerm.size).toBe(1);
      expect(mem.longTerm.get("A")!.weight).toBeGreaterThanOrEqual(1.0);
    });
  });

  describe("!geometric-storage", () => {
    it("short-term trace stores position and vocabulary", () => {
      const root = makeRoot(makeSigil("A", "uses @B"), makeSigil("B", ""));
      const space = build(root);
      const [, trace] = remember(init(), nodeFrom(space, "A"), 1000);

      expect(trace.name).toBe("A");
      expect(trace.vocabulary.name).toBe("A");
      expect(trace.edges).toEqual(nodeFrom(space, "A").edges);
    });
  });

  describe("!reliable + !vocabulary-retrieval", () => {
    it("recognize finds short-term traces", () => {
      const root = {
        name: "Root", language: "@A is here",
        affordances: [{ name: "do-stuff", content: "uses @A" }],
        invariants: [], children: [{
          name: "A", language: "",
          affordances: [{ name: "run", content: "fast" }],
          invariants: [{ name: "stable", content: "always" }],
          children: [],
        }],
      };
      const space = build(root);
      const mem = rem(init(), nodeFrom(space, "A"), 1000);

      const result = recognize(mem, "A");
      expect(result).not.toBeNull();
      expect(result!.remembered.vocabulary.affordances).toContain("run");
      expect(result!.remembered.vocabulary.invariants).toContain("stable");
    });

    it("recognize finds long-term entries", () => {
      const root = makeRoot(makeSigil("A", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000);

      const result = recognize(mem, "A");
      expect(result).not.toBeNull();
    });

    it("recognize prefers long-term over short-term", () => {
      const root = makeRoot(makeSigil("A", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000);
      // Add another short-term trace
      mem = rem(mem, nodeFrom(space, "A"), 3000);

      const result = recognize(mem, "A");
      expect(result).not.toBeNull();
      // Long-term was reinforced during consolidation
      expect(result!.remembered.weight).toBeGreaterThanOrEqual(1.0);
    });

    it("recognize returns null for unknown sigil", () => {
      expect(recognize(init(), "Unknown")).toBeNull();
    });
  });

  describe("!passive-decay + !lossy", () => {
    it("unreinforced long-term sigils decay and get pruned", () => {
      const root = makeRoot(makeSigil("A", "uses @B"), makeSigil("B", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000); // A enters long-term

      // Consolidate many times without attending to A
      for (let i = 0; i < 30; i++) {
        mem = consolidate(mem, [], space, 3000 + i * 1000);
      }

      expect(recognize(mem, "A")).toBeNull();
      expect(allRemembered(mem)).toHaveLength(0);
    });

    it("attended sigils resist decay", () => {
      const root = makeRoot(makeSigil("A", "uses @B"), makeSigil("B", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000);

      for (let i = 0; i < 30; i++) {
        mem = consolidate(mem, ["A"], space, 3000 + i * 1000);
      }

      expect(recognize(mem, "A")).not.toBeNull();
    });
  });

  describe("!adaptive-familiarity", () => {
    it("consolidation with attendance increases weight", () => {
      const root = makeRoot(makeSigil("A", ""), makeSigil("B", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000);
      const w1 = mem.longTerm.get("A")!.weight;

      mem = consolidate(mem, ["A"], space, 3000);
      const w2 = mem.longTerm.get("A")!.weight;

      expect(w2).toBeGreaterThan(w1);
    });

    it("consolidation updates vocabulary from current space", () => {
      const root1 = makeRoot(makeSigil("A", ""), makeSigil("B", ""));
      const space1 = build(root1);
      let mem = rem(init(), nodeFrom(space1, "A"), 1000);
      mem = consolidate(mem, ["A"], space1, 2000);

      const root2 = {
        ...makeRoot(makeSigil("A", ""), makeSigil("B", "")),
        children: [{
          name: "A", language: "",
          affordances: [{ name: "fly", content: "high" }],
          invariants: [], children: [],
        }, makeSigil("B", "")],
      };
      const space2 = build(root2);
      mem = consolidate(mem, ["A"], space2, 3000);

      const result = recognize(mem, "A");
      expect(result!.remembered.vocabulary.affordances).toContain("fly");
    });
  });

  describe("#recall — involuntary recognition", () => {
    it("recalls from both long-term and short-term", () => {
      const root = makeRoot(
        makeSigil("A", "uses @B and @C"),
        makeSigil("B", ""),
        makeSigil("C", ""),
      );
      const space = build(root);

      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000); // A in long-term
      mem = rem(mem, nodeFrom(space, "B"), 3000); // B in short-term

      const results = recall(mem, space, "A");
      const names = results.map(r => r.remembered.name);
      expect(names).toContain("A"); // long-term
      expect(names).toContain("B"); // short-term
    });
  });

  describe("allRemembered", () => {
    it("returns from both layers, long-term first", () => {
      const root = makeRoot(makeSigil("A", ""), makeSigil("B", ""), makeSigil("C", ""));
      const space = build(root);

      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = consolidate(mem, ["A"], space, 2000); // A in long-term, reinforced
      mem = consolidate(mem, ["A"], space, 3000); // reinforce again
      mem = rem(mem, nodeFrom(space, "B"), 4000); // B in short-term

      const all = allRemembered(mem);
      expect(all.map(r => r.name)).toContain("A");
      expect(all.map(r => r.name)).toContain("B");
      // A has higher weight from reinforcement
      expect(all[0].name).toBe("A");
    });
  });

  describe("serialization", () => {
    it("short-term trace round-trips through JSONL", () => {
      const root = makeRoot(makeSigil("A", "uses @B"), makeSigil("B", ""));
      const space = build(root);
      const [, trace] = remember(init(), nodeFrom(space, "A"), 1000);

      const line = serializeTrace(trace);
      const parsed = parseTrace(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe("A");
      expect(parsed!.timestamp).toBe(1000);
      expect(parsed!.vocabulary).toEqual(trace.vocabulary);
    });

    it("long-term round-trips through JSON snapshot", () => {
      const root = makeRoot(makeSigil("A", ""), makeSigil("B", ""));
      const space = build(root);
      let mem = rem(init(), nodeFrom(space, "A"), 1000);
      mem = rem(mem, nodeFrom(space, "B"), 2000);
      mem = consolidate(mem, ["A", "B"], space, 3000);

      const json = serializeLongTerm(mem);
      const restored = parseLongTerm(json);
      expect(restored.size).toBe(mem.longTerm.size);
      expect(restored.get("A")!.weight).toBe(mem.longTerm.get("A")!.weight);
    });
  });
});
