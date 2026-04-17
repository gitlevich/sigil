import { describe, it, expect } from "vitest";
import { threeWayMergeCounts } from "../src/lib/mergeCounts";

describe("threeWayMergeCounts", () => {
  it("reports zero merged and zero conflicts when all three are identical", () => {
    const content = "a\nb\nc";
    expect(threeWayMergeCounts(content, content, content)).toEqual({ mergedCount: 0, conflictCount: 0 });
  });

  it("counts a one-sided change as merged with no conflict", () => {
    const base = "one\ntwo\nthree";
    const mine = "one\ntwo\nthree";
    const theirs = "one\nTWO\nthree";
    const { conflictCount } = threeWayMergeCounts(mine, base, theirs);
    expect(conflictCount).toBe(0);
  });

  it("counts a both-sides divergence as a conflict", () => {
    const base = "alpha\nbeta\ngamma";
    const mine = "alpha\nBETA-MINE\ngamma";
    const theirs = "alpha\nBETA-THEIRS\ngamma";
    const { conflictCount } = threeWayMergeCounts(mine, base, theirs);
    expect(conflictCount).toBeGreaterThanOrEqual(1);
  });

  it("reports no conflict when both sides make the same change", () => {
    const base = "a\nb\nc";
    const same = "a\nB\nc";
    const { conflictCount } = threeWayMergeCounts(same, base, same);
    expect(conflictCount).toBe(0);
  });
});
