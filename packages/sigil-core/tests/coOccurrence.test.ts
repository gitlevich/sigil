import { describe, it, expect } from "vitest";
import type { Sigil } from "../src/types";
import {
  extractCoOccurrences,
  coOccurrenceCount,
  coOccurrenceDistance,
  parsePairKey,
} from "../src/coOccurrence";

function sigil(name: string, language: string, children: Sigil[] = []): Sigil {
  return { name, language, affordances: [], invariants: [], children };
}

describe("extractCoOccurrences", () => {
  it("counts two refs in the same sentence as one co-occurrence", () => {
    const root = sigil("Root", "The @Alpha and @Beta work together.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "Alpha", "Beta")).toBe(1);
  });

  it("counts multiple sentences independently", () => {
    const root = sigil(
      "Root",
      "@Alpha needs @Beta. Also @Alpha uses @Beta here.",
      [sigil("Alpha", ""), sigil("Beta", "")],
    );
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "Alpha", "Beta")).toBe(2);
  });

  it("does not count refs in different sentences as co-occurring", () => {
    const root = sigil("Root", "@Alpha is one thing. @Beta is another.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "Alpha", "Beta")).toBe(0);
  });

  it("pair key is symmetric", () => {
    const [a, b] = parsePairKey("Alpha\0Beta");
    expect(a).toBe("Alpha");
    expect(b).toBe("Beta");

    const root = sigil("Root", "@Beta references @Alpha here.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "Alpha", "Beta")).toBe(1);
    expect(coOccurrenceCount(map, "Beta", "Alpha")).toBe(1);
  });

  it("distance is inverse co-occurrence", () => {
    const root = sigil("Root", "@Alpha and @Beta co-occur.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceDistance(map, "Alpha", "Beta")).toBe(1);
  });

  it("distance is Infinity when sigils never co-occur", () => {
    const root = sigil("Root", "@Alpha alone.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceDistance(map, "Alpha", "Beta")).toBe(Infinity);
  });

  it("collects all sigil names including those never referenced", () => {
    const root = sigil("Root", "@Alpha exists.", [
      sigil("Alpha", ""),
      sigil("Beta", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(map.names.has("Root")).toBe(true);
    expect(map.names.has("Alpha")).toBe(true);
    expect(map.names.has("Beta")).toBe(true);
  });

  it("processes affordance and invariant text", () => {
    const root = sigil("Root", "", [
      {
        name: "Alpha",
        language: "",
        affordances: [{ name: "do-thing", content: "uses @Beta" }],
        invariants: [],
        children: [],
      },
      sigil("Beta", ""),
    ]);
    // Alpha and Beta co-occur in the affordance text
    const map = extractCoOccurrences(root);
    expect(map.names.has("Beta")).toBe(true);
  });

  it("walks nested children", () => {
    const root = sigil("Root", "", [
      sigil("Parent", "@Child1 and @Child2 together.", [
        sigil("Child1", ""),
        sigil("Child2", ""),
      ]),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "Child1", "Child2")).toBe(1);
  });

  it("skips imported ontology internal text", () => {
    const root = sigil("Root", "", [
      {
        ...sigil("Lib", "@Alpha and @Beta entangled inside lib.", [
          sigil("Alpha", ""),
          sigil("Beta", ""),
        ]),
        isImported: true,
      },
    ]);
    const map = extractCoOccurrences(root);
    // Lib's internal text should not produce co-occurrences
    expect(coOccurrenceCount(map, "Alpha", "Beta")).toBe(0);
  });

  it("handles three refs in one sentence as three pairs", () => {
    const root = sigil("Root", "@A and @B and @C all here.", [
      sigil("A", ""),
      sigil("B", ""),
      sigil("C", ""),
    ]);
    const map = extractCoOccurrences(root);
    expect(coOccurrenceCount(map, "A", "B")).toBe(1);
    expect(coOccurrenceCount(map, "A", "C")).toBe(1);
    expect(coOccurrenceCount(map, "B", "C")).toBe(1);
  });
});
