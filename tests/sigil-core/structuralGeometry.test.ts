import { describe, it, expect } from "vitest";
import {
  fibonacciSphere,
  siblingWallPlacements,
  connectionNode,
} from "../../packages/sigil-core/src/structuralGeometry";

const OPENING_THETA = Math.PI * 0.82;

function length(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

describe("fibonacciSphere", () => {
  it("returns empty for zero and the center for one", () => {
    expect(fibonacciSphere(0, 5)).toEqual([]);
    expect(fibonacciSphere(1, 5)).toEqual([[0, 0, 0]]);
  });

  it("places every point on the shell radius", () => {
    for (const p of fibonacciSphere(7, 5.5)) {
      expect(length(p)).toBeCloseTo(5.5, 6);
    }
  });
});

describe("siblingWallPlacements", () => {
  it("returns empty for zero siblings", () => {
    expect(siblingWallPlacements(0, 10, OPENING_THETA)).toEqual([]);
  });

  it("places every contact point on the wall", () => {
    for (const { pos } of siblingWallPlacements(6, 10, OPENING_THETA)) {
      expect(length(pos)).toBeCloseTo(10, 6);
    }
  });

  it("keeps every placement clear of the opening cap", () => {
    // Everything must sit above the rim: theta < OPENING_THETA means
    // y > cos(OPENING_THETA) * radius.
    const rimY = 10 * Math.cos(OPENING_THETA);
    for (const { pos } of siblingWallPlacements(12, 10, OPENING_THETA)) {
      expect(pos[1]).toBeGreaterThan(rimY);
    }
  });

  it("inward is the unit normal pointing at the center", () => {
    for (const { pos, inward } of siblingWallPlacements(5, 10, OPENING_THETA)) {
      expect(length(inward)).toBeCloseTo(1, 6);
      // pos + inward * radius lands at the origin.
      expect(pos[0] + inward[0] * 10).toBeCloseTo(0, 6);
      expect(pos[1] + inward[1] * 10).toBeCloseTo(0, 6);
      expect(pos[2] + inward[2] * 10).toBeCloseTo(0, 6);
    }
  });
});

describe("connectionNode", () => {
  it("pushes the wall point outward (opposite of inward) by length", () => {
    // A wall point on the +x axis: inward points toward origin (-x).
    const node = connectionNode([10, 0, 0], [-1, 0, 0], 3);
    expect(node).toEqual([13, 0, 0]);
  });

  it("lands outside the sphere for any wall placement", () => {
    for (const { pos, inward } of siblingWallPlacements(6, 10, OPENING_THETA)) {
      const node = connectionNode(pos, inward, 3.2);
      expect(length(node)).toBeGreaterThan(10);
    }
  });

  it("zero length returns the wall point itself", () => {
    expect(connectionNode([1, 2, 2], [-1 / 3, -2 / 3, -2 / 3], 0)).toEqual([1, 2, 2]);
  });
});
