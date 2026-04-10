import { describe, it, expect } from "vitest";
import { buildRefPattern, buildRefLookup, highlightText, styleForPrefix, type Segment } from "../../packages/sigil-core/src/highlight";
import type { Ref } from "../../packages/sigil-core/src/refs";

const refs: Ref[] = [
  { name: "Chat", prefix: "@", summary: "Chat context", navigable: true },
  { name: "sigil", prefix: "@", summary: "Sigil context", navigable: true },
  { name: "DesignPartner", prefix: "@", summary: "DP context", navigable: true },
  { name: "persists", prefix: "#", summary: "Persists affordance", navigable: false },
  { name: "persist", prefix: "#", summary: "Persist affordance", navigable: false },
  { name: "interrupt", prefix: "#", summary: "Interrupt affordance", navigable: false },
  { name: "branch", prefix: "#", summary: "Branch affordance", navigable: false },
  { name: "full-context", prefix: "!", summary: "Full context invariant", navigable: false },
];

function segmentSummary(segments: Segment[]) {
  return segments
    .filter((s) => s.kind === "ref")
    .map((s) => {
      if (s.kind !== "ref") return null;
      return { text: s.text, prefix: s.prefix };
    });
}

describe("highlightText", () => {
  const pattern = buildRefPattern(refs)!;
  const lookup = buildRefLookup(refs);

  it("highlights simple @context ref", () => {
    const result = segmentSummary(highlightText("I use @Chat daily", pattern, lookup));
    expect(result).toEqual([{ text: "@Chat", prefix: "@" }]);
  });

  it("highlights simple #affordance ref", () => {
    const result = segmentSummary(highlightText("The conversation #persists", pattern, lookup));
    expect(result).toEqual([{ text: "#persists", prefix: "#" }]);
  });

  it("highlights simple !invariant ref", () => {
    const result = segmentSummary(highlightText("requires !full-context", pattern, lookup));
    expect(result).toEqual([{ text: "!full-context", prefix: "!" }]);
  });

  it("highlights compound @Context#affordance as single affordance-styled segment", () => {
    const result = segmentSummary(highlightText("I @Chat#interrupt the partner", pattern, lookup));
    expect(result).toEqual([{ text: "@Chat#interrupt", prefix: "#" }]);
  });

  it("highlights compound @Context#affordance at end of sentence", () => {
    const result = segmentSummary(highlightText("I @Chat#branch.", pattern, lookup));
    expect(result).toEqual([{ text: "@Chat#branch", prefix: "#" }]);
  });

  it("highlights compound @Context!invariant as single invariant-styled segment", () => {
    const result = segmentSummary(highlightText("uses @sigil!full-context always", pattern, lookup));
    expect(result).toEqual([{ text: "@sigil!full-context", prefix: "!" }]);
  });

  it("highlights multiple refs in one string", () => {
    const result = segmentSummary(
      highlightText("Through @Chat: @Chat#persists across sessions, I @Chat#interrupt", pattern, lookup)
    );
    expect(result).toEqual([
      { text: "@Chat", prefix: "@" },
      { text: "@Chat#persists", prefix: "#" },
      { text: "@Chat#interrupt", prefix: "#" },
    ]);
  });

  it("highlights compound ref even when affordance is NOT in scope (child's affordance referenced from parent)", () => {
    // DesignPartner scope: has @Chat but NOT #branch (that belongs to Chat)
    const parentRefs: Ref[] = [
      { name: "Chat", prefix: "@", summary: "Chat context", navigable: true },
      { name: "sigil", prefix: "@", summary: "Sigil context", navigable: true },
      { name: "full-context", prefix: "!", summary: "Full context invariant", navigable: false },
    ];
    const p = buildRefPattern(parentRefs)!;
    const l = buildRefLookup(parentRefs);
    const result = segmentSummary(
      highlightText("I @Chat#branch. The conversation @Chat#persists.", p, l)
    );
    // @Chat#branch should highlight as a single context ref (since #branch isn't in scope,
    // fall back to context styling for the whole compound)
    // The # prefix tells us the type — affordance styling even when not in scope
    expect(result).toEqual([
      { text: "@Chat#branch", prefix: "#" },
      { text: "@Chat#persists", prefix: "#" },
    ]);
  });
});

// ── styleForPrefix ──

describe("styleForPrefix", () => {
  it("returns ref-context for @", () => expect(styleForPrefix("@")).toBe("ref-context"));
  it("returns ref-affordance for #", () => expect(styleForPrefix("#")).toBe("ref-affordance"));
  it("returns ref-invariant for !", () => expect(styleForPrefix("!")).toBe("ref-invariant"));
  it("returns ref-context for unknown prefix", () => expect(styleForPrefix("?")).toBe("ref-context"));
});

// ── buildRefPattern ──

describe("buildRefPattern", () => {
  it("returns null for empty refs", () => {
    expect(buildRefPattern([])).toBeNull();
  });

  it("includes inflected forms for -e ending words", () => {
    const pattern = buildRefPattern([
      { name: "Collapse", prefix: "@", summary: "", navigable: true },
    ])!;
    expect("@Collapsed".match(pattern)).not.toBeNull();
    expect("@Collapsing".match(pattern)).not.toBeNull();
  });

  it("includes adjective/noun inflections", () => {
    const pattern = buildRefPattern([
      { name: "beauty", prefix: "#", summary: "", navigable: false },
    ])!;
    expect("#beautiful".match(pattern)).not.toBeNull();
  });
});

// ── buildRefLookup ──

describe("buildRefLookup", () => {
  it("maps inflected forms for -e ending names", () => {
    const lookup = buildRefLookup([
      { name: "Collapse", prefix: "@", summary: "", navigable: true },
    ]);
    expect(lookup["@collapsed"]).toBeDefined();
    expect(lookup["@collapsing"]).toBeDefined();
    expect(lookup["@collapses"]).toBeDefined();
  });

  it("maps inflected forms for non-e ending names", () => {
    const lookup = buildRefLookup([
      { name: "Attend", prefix: "@", summary: "", navigable: true },
    ]);
    expect(lookup["@attended"]).toBeDefined();
    expect(lookup["@attending"]).toBeDefined();
  });

  it("maps adjective-noun y/iful forms", () => {
    const lookup = buildRefLookup([
      { name: "beauty", prefix: "#", summary: "", navigable: false },
      { name: "beautiful", prefix: "#", summary: "", navigable: false },
    ]);
    expect(lookup["#beautiful"]).toBeDefined();
    expect(lookup["#beauty"]).toBeDefined();
  });
});

// ── highlightText: unmatched refs fallback ──

describe("highlightText edge cases", () => {
  it("returns plain text for unmatched compound ref", () => {
    // Pattern matches the name but lookup doesn't contain it
    const refList: Ref[] = [
      { name: "Widget", prefix: "@", summary: "", navigable: true },
    ];
    const pattern = buildRefPattern(refList)!;
    // Empty lookup — no entries
    const result = highlightText("@Widget#missing text", pattern, {});
    // Widget not in lookup, so compound falls through to text
    const texts = result.filter((s) => s.kind === "text").map((s) => s.text);
    expect(texts.join("")).toBe("@Widget#missing text");
  });

  it("returns plain text for unmatched standalone ref", () => {
    const refList: Ref[] = [
      { name: "render", prefix: "#", summary: "", navigable: false },
    ];
    const pattern = buildRefPattern(refList)!;
    const result = highlightText("#render here", pattern, {});
    const texts = result.filter((s) => s.kind === "text").map((s) => s.text);
    expect(texts.join("")).toBe("#render here");
  });

  it("returns plain text for unmatched simple @ ref", () => {
    const refList: Ref[] = [
      { name: "Observer", prefix: "@", summary: "", navigable: true },
    ];
    const pattern = buildRefPattern(refList)!;
    const result = highlightText("@Observer here", pattern, {});
    const texts = result.filter((s) => s.kind === "text").map((s) => s.text);
    expect(texts.join("")).toBe("@Observer here");
  });
});
