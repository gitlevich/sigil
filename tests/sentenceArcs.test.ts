import { describe, it, expect } from "vitest";
import { splitSentences, extractArcs, arcLabel } from "../src/lib/sentenceArcs";

describe("splitSentences", () => {
  it("splits on sentence-end punctuation", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("splits on blank lines", () => {
    expect(splitSentences("Para one.\n\nPara two.")).toEqual(["Para one.", "Para two."]);
  });

  it("drops fenced code blocks", () => {
    const text = "Alpha.\n\n```\n@Code @Inside\n```\n\nBeta.";
    expect(splitSentences(text)).toEqual(["Alpha.", "Beta."]);
  });

  it("treats headings as their own units", () => {
    const out = splitSentences("# Heading\n\nBody sentence.");
    expect(out[0]).toContain("Heading");
    expect(out).toContain("Body sentence.");
  });

  it("strips YAML frontmatter", () => {
    const text = "---\nstatus: idea\n---\n\nReal body.";
    expect(splitSentences(text)).toEqual(["Real body."]);
  });
});

describe("extractArcs", () => {
  it("emits no arcs when fewer than two children co-occur", () => {
    const text = "Just @One child here.";
    expect(extractArcs(text, ["One", "Two"])).toEqual([]);
  });

  it("finds an arc between two children in the same sentence", () => {
    const text = "I use @LeftHemisphere to speak and @RightHemisphere to see.";
    const arcs = extractArcs(text, ["LeftHemisphere", "RightHemisphere"]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].a).toBe("LeftHemisphere");
    expect(arcs[0].b).toBe("RightHemisphere");
    expect(arcs[0].sentenceIndex).toBe(0);
  });

  it("emits all pairs when three children share a sentence", () => {
    const text = "@A @B and @C together.";
    const arcs = extractArcs(text, ["A", "B", "C"]);
    expect(arcs).toHaveLength(3);
    const pairs = arcs.map((a) => [a.a, a.b].sort().join("-")).sort();
    expect(pairs).toEqual(["A-B", "A-C", "B-C"]);
  });

  it("deduplicates same child named twice in a sentence", () => {
    const text = "@A and @A again with @B.";
    const arcs = extractArcs(text, ["A", "B"]);
    expect(arcs).toHaveLength(1);
  });

  it("separates sentences — cross-sentence co-occurrence produces no arc", () => {
    const text = "@A is here. @B is there.";
    const arcs = extractArcs(text, ["A", "B"]);
    expect(arcs).toEqual([]);
  });

  it("ignores non-child @refs", () => {
    const text = "@ExternalGod grants @A power.";
    const arcs = extractArcs(text, ["A"]);
    expect(arcs).toEqual([]);
  });
});

describe("arcLabel", () => {
  it("returns the whole sentence if short enough", () => {
    expect(arcLabel("Short.")).toBe("Short.");
  });

  it("truncates long sentences with an ellipsis", () => {
    const long = "This is a rather long sentence that certainly exceeds the maximum length threshold.";
    const out = arcLabel(long, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("\u2026")).toBe(true);
  });
});
