import { describe, it, expect } from "vitest";
import { buildLexicalScope, findAffordanceInScope, findInvariantInScope } from "./refs";
import type { Context } from "./types";

function ctx(name: string, opts?: {
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  children?: Context[];
}): Context {
  return {
    name,
    domain_language: "",
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

const root: Context = ctx("root", {
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
