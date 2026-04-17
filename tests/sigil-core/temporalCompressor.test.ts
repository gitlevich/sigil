/**
 * Temporal compressor tests — keep what pulls, drop what doesn't.
 */
import { describe, it, expect } from "vitest";
import { sinceLast, filterByPull } from "sigil-core/temporalCompressor";

type E = {
  timestamp: number;
  kind: "language" | "affordance" | "invariant" | "structural";
  summary: string;
};

describe("sinceLast", () => {
  it("keeps all when since is null", () => {
    const events: E[] = [
      { timestamp: 10, kind: "structural", summary: "" },
      { timestamp: 20, kind: "structural", summary: "" },
    ];
    expect(sinceLast(events, null)).toEqual(events);
  });

  it("filters to strictly-after events", () => {
    const events: E[] = [
      { timestamp: 10, kind: "structural", summary: "a" },
      { timestamp: 20, kind: "structural", summary: "b" },
      { timestamp: 30, kind: "structural", summary: "c" },
    ];
    const out = sinceLast(events, 15);
    expect(out.map((e) => e.summary)).toEqual(["b", "c"]);
  });

  it("empty result when since is past the last", () => {
    const events: E[] = [
      { timestamp: 10, kind: "structural", summary: "a" },
    ];
    expect(sinceLast(events, 100)).toEqual([]);
  });
});

describe("filterByPull", () => {
  it("keeps structural events", () => {
    const events: E[] = [
      { timestamp: 1, kind: "structural", summary: "@X created" },
    ];
    expect(filterByPull(events)).toEqual(events);
  });

  it("keeps affordance and invariant changes", () => {
    const events: E[] = [
      { timestamp: 1, kind: "affordance", summary: "@X added #do-thing" },
      { timestamp: 2, kind: "invariant", summary: "@X now holds !safe" },
    ];
    expect(filterByPull(events)).toEqual(events);
  });

  it("drops bare language edits", () => {
    const events: E[] = [
      { timestamp: 1, kind: "language", summary: "language in @X changed" },
    ];
    expect(filterByPull(events)).toEqual([]);
  });

  it("keeps language events with structural implication", () => {
    const events: E[] = [
      { timestamp: 1, kind: "language", summary: "@X now unresolved" },
      { timestamp: 2, kind: "language", summary: "@X now references @Y" },
      { timestamp: 3, kind: "language", summary: "@X resolved" },
      { timestamp: 4, kind: "language", summary: "dangling @Z" },
    ];
    expect(filterByPull(events).length).toBe(4);
  });

  it("mixed stream collapses to pull-worthy only", () => {
    const events: E[] = [
      { timestamp: 1, kind: "language", summary: "language in @X changed" },
      { timestamp: 2, kind: "structural", summary: "@Y created" },
      { timestamp: 3, kind: "language", summary: "another bare edit in @X" },
      { timestamp: 4, kind: "invariant", summary: "@Y now holds !geometric-storage" },
    ];
    const out = filterByPull(events);
    expect(out.map((e) => e.timestamp)).toEqual([2, 4]);
  });
});
