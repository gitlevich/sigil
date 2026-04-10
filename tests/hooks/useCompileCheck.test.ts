import { describe, it, expect } from "vitest";
import type { Sigil } from "sigil-core";
import { compileCheck } from "../../src/../src/hooks/useCompileCheck";

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
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

describe("compileCheck", () => {
  it("returns zero errors for a tree with no references", () => {
    const root = sigil("Root", {
      language: "This has no references at all.",
      children: [sigil("Child", { language: "Plain text." })],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(0);
  });

  it("resolves a valid @child reference", () => {
    const root = sigil("Root", {
      language: "See @Child for details.",
      children: [sigil("Child", { language: "I am a child." })],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(1);
  });

  it("reports an unresolved @sigil reference", () => {
    const root = sigil("Root", {
      language: "See @NonExistent for details.",
      children: [sigil("Child")],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref).toBe("@NonExistent");
    expect(result.errors[0].reason).toBe("unresolved sigil");
    expect(result.errors[0].line).toBe(1);
    expect(result.errors[0].path).toEqual([]);
  });

  it("resolves a valid #affordance reference", () => {
    const root = sigil("Root", {
      language: "This uses #my-affordance here.",
      affordances: [{ name: "my-affordance", content: "does something" }],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(1);
  });

  it("reports an unresolved #affordance reference", () => {
    const root = sigil("Root", {
      language: "This uses #missing-aff here.",
      affordances: [{ name: "other", content: "not this" }],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref).toBe("#missing-aff");
    expect(result.errors[0].reason).toBe("unresolved affordance");
  });

  it("resolves a valid !invariant reference", () => {
    const root = sigil("Root", {
      language: "Must satisfy !my-rule always.",
      invariants: [{ name: "my-rule", content: "always true" }],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(1);
  });

  it("reports an unresolved !invariant reference", () => {
    const root = sigil("Root", {
      language: "Must satisfy !no-such-rule.",
      invariants: [],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref).toBe("!no-such-rule");
    expect(result.errors[0].reason).toBe("unresolved invariant");
  });

  it("child can reference sibling via lexical scope", () => {
    const root = sigil("Root", {
      children: [
        sigil("Alpha", { language: "See @Beta." }),
        sigil("Beta"),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(1);
  });

  it("child can reference parent affordance", () => {
    const root = sigil("Root", {
      affordances: [{ name: "root-power", content: "big" }],
      children: [
        sigil("Child", { language: "Uses #root-power." }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
  });

  it("resolves multi-segment @ref like @Child@Grandchild", () => {
    const root = sigil("Root", {
      language: "Navigate to @Child@Grandchild.",
      children: [
        sigil("Child", {
          children: [sigil("Grandchild")],
        }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRefs).toBe(1);
  });

  it("reports error for broken multi-segment @ref", () => {
    const root = sigil("Root", {
      language: "Navigate to @Child@Missing.",
      children: [
        sigil("Child", { children: [sigil("Grandchild")] }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref).toBe("@Child@Missing");
  });

  it("ignores references inside code spans", () => {
    const root = sigil("Root", {
      language: "Use `@NotARef` in code.",
    });
    const result = compileCheck(root);
    expect(result.totalRefs).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("checks affordance file content too", () => {
    const root = sigil("Root", {
      affordances: [{ name: "do-thing", content: "Requires @Ghost to work." }],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("affordance-do-thing.md");
    expect(result.errors[0].ref).toBe("@Ghost");
  });

  it("checks invariant file content too", () => {
    const root = sigil("Root", {
      invariants: [{ name: "must-hold", content: "Depends on @Phantom." }],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("invariant-must-hold.md");
  });

  it("skips imported sigils when walking", () => {
    const root = sigil("Root", {
      language: "See @Libs.",
      children: [
        sigil("Libs", {
          isImported: true,
          language: "I reference @BogusStuff that does not exist.",
          children: [sigil("BogusStuff")],
        }),
      ],
    });
    const result = compileCheck(root);
    // Root's @Libs should resolve (it's a child), but Libs' content is not checked
    expect(result.errors).toHaveLength(0);
  });

  it("resolves @ref to imported lib sigil children in scope", () => {
    const root = sigil("Root", {
      language: "Uses @LibChild concept.",
      children: [
        sigil("Libs", {
          isImported: true,
          children: [sigil("LibChild")],
        }),
      ],
    });
    const result = compileCheck(root);
    // LibChild should be in scope as grandchild of root via Libs
    expect(result.errors).toHaveLength(0);
  });

  it("path in error reflects sigil tree position", () => {
    const root = sigil("Root", {
      children: [
        sigil("A", {
          children: [
            sigil("B", { language: "Broken ref @ZZZZZ." }),
          ],
        }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toEqual(["A", "B"]);
  });

  it("counts filesWithErrors correctly", () => {
    const root = sigil("Root", {
      language: "@Missing1 and @Missing2.",
      children: [
        sigil("Child", { language: "@AlsoMissing." }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(3);
    expect(result.filesWithErrors).toBe(2);
  });

  it("reports correct line numbers for multi-line content", () => {
    const root = sigil("Root", {
      language: "Line one.\nLine two.\n@Broken on line three.",
      children: [],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
  });

  it("error path excludes root name, suitable for workspace navigate", () => {
    const root = sigil("specification.sigil", {
      children: [
        sigil("Application", {
          children: [
            sigil("DesignPartner", {
              language: "Uses @BogusRef here.",
            }),
          ],
        }),
      ],
    });
    const result = compileCheck(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toEqual(["Application", "DesignPartner"]);
  });
});
