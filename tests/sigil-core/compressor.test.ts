/**
 * Compressor tests — flatten a sigil tree to a narrative that preserves
 * the thesis of each sigil and the topology.
 */
import { describe, it, expect } from "vitest";
import { compressSigil, extractThesis } from "sigil-core/compressor";
import type { Sigil } from "sigil-core/types";

function sigil(
  name: string,
  language: string,
  children: Sigil[] = [],
): Sigil {
  return { name, language, affordances: [], invariants: [], children };
}

describe("extractThesis", () => {
  it("drops frontmatter and leading heading, keeps first sentence", () => {
    const lang = "---\nstatus: idea\n---\n\n# Memory\n\nI am the @DesignPartner. My self is here.";
    expect(extractThesis(lang)).toBe("I am the @DesignPartner.");
  });

  it("handles missing frontmatter", () => {
    const lang = "# Love\n\n@Love is @attention attracted to @beauty.";
    expect(extractThesis(lang)).toBe("@Love is @attention attracted to @beauty.");
  });

  it("returns empty for empty language", () => {
    expect(extractThesis("")).toBe("");
    expect(extractThesis("---\nstatus: idea\n---\n")).toBe("");
  });

  it("collapses internal whitespace", () => {
    const lang = "# X\n\nOne   sentence  with   gaps.";
    expect(extractThesis(lang)).toBe("One sentence with gaps.");
  });
});

describe("compressSigil", () => {
  it("emits root with thesis", () => {
    const tree = sigil("Root", "# Root\n\nThe root thesis.");
    const out = compressSigil(tree);
    expect(out).toContain("@Root: The root thesis.");
  });

  it("preserves topology through children", () => {
    const tree = sigil("A", "I am A.", [
      sigil("B", "B is inside A.", [
        sigil("C", "C is a leaf."),
      ]),
    ]);
    const out = compressSigil(tree);
    expect(out).toContain("@A: I am A.");
    expect(out).toContain("@B: B is inside A.");
    expect(out).toContain("@C: C is a leaf.");
    // Indentation grows with depth.
    const lines = out.split("\n");
    const aLine = lines.find((l) => l.includes("@A:"))!;
    const bLine = lines.find((l) => l.includes("@B:"))!;
    const cLine = lines.find((l) => l.includes("@C:"))!;
    expect(aLine.indexOf("@A:")).toBeLessThan(bLine.indexOf("@B:"));
    expect(bLine.indexOf("@B:")).toBeLessThan(cLine.indexOf("@C:"));
  });

  it("names affordances, invariants, and children when present", () => {
    const tree: Sigil = {
      name: "X",
      language: "X is a thing.",
      affordances: [{ name: "do-thing", content: "" }],
      invariants: [{ name: "stays-a-thing", content: "" }],
      children: [sigil("Y", "Y is a child.")],
    };
    const out = compressSigil(tree);
    expect(out).toContain("#do-thing");
    expect(out).toContain("!stays-a-thing");
    expect(out).toContain("@Y");
  });

  it("keeps output small even for a many-child tree", () => {
    const tree = sigil(
      "Root",
      "Root thesis.",
      Array.from({ length: 20 }, (_, i) =>
        sigil(`Child${i}`, `Thesis of child ${i}.`),
      ),
    );
    const out = compressSigil(tree);
    // 20 children + root — should be well under 2 KB.
    expect(out.length).toBeLessThan(2000);
  });
});
