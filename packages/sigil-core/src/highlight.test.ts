import { describe, it, expect } from "vitest";
import { buildRefPattern, buildRefLookup, highlightText, type Segment } from "./highlight";
import type { Ref } from "./refs";

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
    expect(result).toEqual([
      { text: "@Chat#branch", prefix: "@" },
      { text: "@Chat#persists", prefix: "@" },
    ]);
  });
});
