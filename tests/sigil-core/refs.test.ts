import { describe, it, expect } from "vitest";
import {
  buildLexicalScope, findAffordanceInScope, findInvariantInScope,
  resolveRefName, findAffordance, flattenName, buildNameIndex, fromDashForm,
} from "../../packages/sigil-core/src/refs";
import type { Sigil } from "../../packages/sigil-core/src/types";

function ctx(name: string, opts?: {
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  children?: Sigil[];
}): Sigil {
  return {
    name,
    language: "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
  };
}

function refNames(refs: { name: string; prefix: string }[], prefix: string): string[] {
  return refs.filter((r) => r.prefix === prefix).map((r) => r.name).sort();
}

/*
  Tree used by tests:

  root
  ├── Alpha
  │   ├── #alpha-aff
  │   ├── !alpha-inv
  │   ├── Child1
  │   │   ├── #child1-aff
  │   │   └── !child1-inv
  │   └── Child2
  │       └── #child2-aff
  └── Beta
      ├── #beta-aff
      └── BetaChild
          └── #betachild-aff
*/

const root: Sigil = ctx("root", {
  children: [
    ctx("Alpha", {
      affordances: [{ name: "alpha-aff", content: "alpha affordance" }],
      invariants: [{ name: "alpha-inv", content: "alpha invariant" }],
      children: [
        ctx("Child1", {
          affordances: [{ name: "child1-aff", content: "child1 affordance" }],
          invariants: [{ name: "child1-inv", content: "child1 invariant" }],
        }),
        ctx("Child2", {
          affordances: [{ name: "child2-aff", content: "child2 affordance" }],
        }),
      ],
    }),
    ctx("Beta", {
      affordances: [{ name: "beta-aff", content: "beta affordance" }],
      children: [
        ctx("BetaChild", {
          affordances: [{ name: "betachild-aff", content: "betachild affordance" }],
        }),
      ],
    }),
  ],
});

describe("buildLexicalScope", () => {
  it("from Alpha, includes own affordances and invariants", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    expect(refNames(refs, "#")).toContain("alpha-aff");
    expect(refNames(refs, "!")).toContain("alpha-inv");
  });

  it("from Alpha, includes children as @-refs", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const contexts = refNames(refs, "@");
    expect(contexts).toContain("Child1");
    expect(contexts).toContain("Child2");
  });

  it("from Alpha, includes sibling Beta as @-ref", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const contexts = refNames(refs, "@");
    expect(contexts).toContain("Beta");
  });

  it("from Alpha, includes children's affordances", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const affordances = refNames(refs, "#");
    expect(affordances).toContain("child1-aff");
    expect(affordances).toContain("child2-aff");
  });

  it("from Alpha, includes children's invariants", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const invariants = refNames(refs, "!");
    expect(invariants).toContain("child1-inv");
  });

  it("from Alpha, includes sibling Beta's affordances (one level deep)", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const affordances = refNames(refs, "#");
    expect(affordances).toContain("beta-aff");
  });

  it("from Alpha, does NOT include sibling's child's affordances (two levels deep)", () => {
    const refs = buildLexicalScope(root, ["Alpha"]);
    const affordances = refNames(refs, "#");
    expect(affordances).not.toContain("betachild-aff");
  });

  it("from Child1, includes parent Alpha's affordances via ancestry", () => {
    const refs = buildLexicalScope(root, ["Alpha", "Child1"]);
    const affordances = refNames(refs, "#");
    expect(affordances).toContain("alpha-aff");
  });

  it("from Child1, includes sibling Child2's affordances (one level deep into parent's children)", () => {
    const refs = buildLexicalScope(root, ["Alpha", "Child1"]);
    const affordances = refNames(refs, "#");
    expect(affordances).toContain("child2-aff");
  });
});

describe("findAffordanceInScope", () => {
  it("finds own affordance on current context", () => {
    const result = findAffordanceInScope(root, ["Alpha"], "alpha-aff");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("alpha affordance");
  });

  it("finds child's affordance from parent", () => {
    const result = findAffordanceInScope(root, ["Alpha"], "child1-aff");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("child1 affordance");
  });

  it("finds sibling's affordance (one level deep into parent's children)", () => {
    const result = findAffordanceInScope(root, ["Alpha"], "beta-aff");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("beta affordance");
  });

  it("does NOT find sibling's child's affordance (two levels deep)", () => {
    const result = findAffordanceInScope(root, ["Alpha"], "betachild-aff");
    expect(result).toBeNull();
  });

  it("finds ancestor affordance from deep path", () => {
    const result = findAffordanceInScope(root, ["Alpha", "Child1"], "alpha-aff");
    expect(result).not.toBeNull();
  });

  it("finds sibling's affordance from deep path (parent's children are in scope)", () => {
    const result = findAffordanceInScope(root, ["Alpha", "Child1"], "child2-aff");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("child2 affordance");
  });

  it("returns null for nonexistent affordance", () => {
    const result = findAffordanceInScope(root, ["Alpha"], "nonexistent");
    expect(result).toBeNull();
  });
});

describe("findInvariantInScope", () => {
  it("finds own invariant on current context", () => {
    const result = findInvariantInScope(root, ["Alpha"], "alpha-inv");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("alpha invariant");
  });

  it("finds child's invariant from parent", () => {
    const result = findInvariantInScope(root, ["Alpha"], "child1-inv");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("child1 invariant");
  });

  it("finds ancestor invariant from deep path", () => {
    const result = findInvariantInScope(root, ["Alpha", "Child1"], "alpha-inv");
    expect(result).not.toBeNull();
  });
});

// ── flattenName ──

describe("flattenName", () => {
  it("lowercases and strips separators", () => {
    expect(flattenName("Hello-World")).toBe("helloworld");
    expect(flattenName("Hello World")).toBe("helloworld");
    expect(flattenName("Hello_World")).toBe("helloworld");
  });

  it("handles empty string", () => {
    expect(flattenName("")).toBe("");
  });
});

// ── fromDashForm ──

describe("fromDashForm", () => {
  it("replaces dashes with spaces", () => {
    expect(fromDashForm("hello-world")).toBe("hello world");
  });

  it("handles no dashes", () => {
    expect(fromDashForm("hello")).toBe("hello");
  });
});

// ── buildNameIndex ──

describe("buildNameIndex", () => {
  it("maps lowercase and flattened forms to canonical names", () => {
    const idx = buildNameIndex(["Hello World", "FooBar"]);
    expect(idx.get("hello world")).toBe("Hello World");
    expect(idx.get("helloworld")).toBe("Hello World");
    expect(idx.get("foobar")).toBe("FooBar");
  });

  it("empty input yields empty map", () => {
    expect(buildNameIndex([]).size).toBe(0);
  });
});

// ── resolveRefName ──

describe("resolveRefName", () => {
  const names = ["Observer", "Collapse", "beauty", "Attend"];

  it("exact match (case-insensitive)", () => {
    expect(resolveRefName("observer", names)).toBe("Observer");
  });

  it("flattened match", () => {
    expect(resolveRefName("OBSERVER", names)).toBe("Observer");
  });

  it("plural -ies to -y", () => {
    // "beauties" → "beauty"
    expect(resolveRefName("beauties", ["beauty"])).toBe("beauty");
  });

  it("plural -s", () => {
    expect(resolveRefName("Observers", names)).toBe("Observer");
  });

  it("past tense -ed", () => {
    // "Collapsed" → "Collapse" (strip -d)
    expect(resolveRefName("Collapsed", names)).toBe("Collapse");
  });

  it("past tense -ed (strip -ed)", () => {
    // "Attended" → "Attend" (strip -ed)
    expect(resolveRefName("Attended", names)).toBe("Attend");
  });

  it("present continuous -ing", () => {
    // "Collapsing" → "Collapse" (strip -ing, add -e)
    expect(resolveRefName("Collapsing", names)).toBe("Collapse");
  });

  it("present continuous -ing (direct strip)", () => {
    // "Attending" → "Attend" (strip -ing)
    expect(resolveRefName("Attending", names)).toBe("Attend");
  });

  it("adjective -iful to -y", () => {
    expect(resolveRefName("beautiful", names)).toBe("beauty");
  });

  it("noun -y to adjective -iful", () => {
    expect(resolveRefName("beauty", ["beautiful"])).toBe("beautiful");
  });

  it("returns undefined for unknown", () => {
    expect(resolveRefName("Unknown", names)).toBeUndefined();
  });
});

// ── findAffordance ──

describe("findAffordance", () => {
  it("returns undefined for undefined sigil", () => {
    expect(findAffordance(undefined, "x")).toBeUndefined();
  });

  it("finds by exact dashed name", () => {
    const sigil = ctx("S", { affordances: [{ name: "navigate here", content: "go" }] });
    expect(findAffordance(sigil, "navigate-here")?.content).toBe("go");
  });

  it("finds by exact spaced name", () => {
    const sigil = ctx("S", { affordances: [{ name: "navigate here", content: "go" }] });
    expect(findAffordance(sigil, "navigate here")?.content).toBe("go");
  });

  it("finds via fuzzy matching (plural)", () => {
    const sigil = ctx("S", { affordances: [{ name: "observer", content: "watch" }] });
    expect(findAffordance(sigil, "observers")?.content).toBe("watch");
  });

  it("returns undefined when not found", () => {
    const sigil = ctx("S", { affordances: [{ name: "render", content: "draw" }] });
    expect(findAffordance(sigil, "missing")).toBeUndefined();
  });
});

// ── buildLexicalScope with ontologies ──

describe("buildLexicalScope with Libs", () => {
  it("includes flattened ontology refs", () => {
    const libChild = ctx("Concept", { children: [ctx("SubConcept")] });
    const libs = ctx("Libs", { children: [libChild] });
    const rootWithLibs = ctx("root", { children: [libs] });
    const scope = buildLexicalScope(rootWithLibs, []);
    const names = scope.filter((r) => r.prefix === "@").map((r) => r.name);
    expect(names).toContain("Concept");
    expect(names).toContain("SubConcept");
  });
});
