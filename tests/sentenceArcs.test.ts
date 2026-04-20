import { describe, it, expect } from "vitest";
import { splitSentences, splitParagraphs, extractArcs, arcLabel } from "../src/lib/sentenceArcs";

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

  it("chains neighboring refs — three children in a sentence make a path, not a clique", () => {
    const text = "@A @B and @C together.";
    const arcs = extractArcs(text, ["A", "B", "C"]);
    expect(arcs).toHaveLength(2);
    const pairs = arcs.map((a) => [a.a, a.b].sort().join("-"));
    expect(pairs).toEqual(["A-B", "B-C"]);
  });

  it("collapses consecutive repeats so a ref does not link to itself", () => {
    const text = "@A and @A again with @B.";
    const arcs = extractArcs(text, ["A", "B"]);
    expect(arcs).toHaveLength(1);
    expect([arcs[0].a, arcs[0].b].sort()).toEqual(["A", "B"]);
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

  it("treats refs as adjacent when no other child ref lives between them, regardless of prose", () => {
    // Plenty of words between @A and @B, but no other reference — they are
    // still neighbors in the reference sequence.
    const arcs1 = extractArcs("@A wanders through a long clause of commentary before @B.", ["A", "B"]);
    expect(arcs1).toHaveLength(1);
    expect([arcs1[0].a, arcs1[0].b].sort()).toEqual(["A", "B"]);

    // A non-child @External ref does NOT break adjacency between @A and @B
    // — only refs that resolve to children count as structural neighbors.
    const arcs2 = extractArcs("@A through @External arrives at @B.", ["A", "B"]);
    expect(arcs2).toHaveLength(1);
    expect([arcs2[0].a, arcs2[0].b].sort()).toEqual(["A", "B"]);

    // A child ref BETWEEN @A and @B does break the direct link: adjacency
    // becomes A–M and M–B, not A–B.
    const arcs3 = extractArcs("@A passes @M and reaches @B.", ["A", "M", "B"]);
    const pairs3 = arcs3.map((a) => [a.a, a.b].sort().join("-")).sort();
    expect(pairs3).toEqual(["A-M", "B-M"]);
  });

  it("resolves lowercase and inflected refs and chains them in reading order", () => {
    // @i → I, @am → Am, @sigils → Sigil (plural), @speaking → Speaking,
    // @this → This. Adjacency only: five refs in order make a four-link chain.
    const text = "@i @am @speaking @this @sigils into existence.";
    const arcs = extractArcs(text, ["I", "Am", "Speaking", "This", "Sigil"]);
    expect(arcs).toHaveLength(4);
    const pairs = arcs.map((a) => [a.a, a.b].sort().join("-"));
    expect(pairs).toEqual(["Am-I", "Am-Speaking", "Speaking-This", "Sigil-This"]);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines", () => {
    const out = splitParagraphs("One line.\nStill one.\n\nTwo.");
    expect(out).toEqual(["One line.\nStill one.", "Two."]);
  });

  it("drops frontmatter and code fences", () => {
    const text = "---\nstatus: idea\n---\n\nAlpha.\n\n```\nin code\n```\n\nBeta.";
    expect(splitParagraphs(text)).toEqual(["Alpha.", "Beta."]);
  });
});

describe("extractArcs with paragraph scope", () => {
  it("chains children in the same paragraph in reading order across sentences", () => {
    const text = "I have a @A. I have a @B. I have a @C.";
    const arcs = extractArcs(text, ["A", "B", "C"], "paragraph");
    expect(arcs).toHaveLength(2);
    const pairs = arcs.map((a) => [a.a, a.b].sort().join("-"));
    expect(pairs).toEqual(["A-B", "B-C"]);
  });

  it("respects paragraph boundaries", () => {
    const text = "I have a @A.\n\nI have a @B.";
    const arcs = extractArcs(text, ["A", "B"], "paragraph");
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
