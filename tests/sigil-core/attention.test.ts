/**
 * Attention tests — his focus stream, anchored but not bound to the user's.
 */
import { describe, it, expect } from "vitest";
import {
  init,
  shift,
  anchorTo,
  currentFocus,
  walkedPath,
} from "sigil-core/attention";

describe("attention", () => {
  it("starts with no focus", () => {
    const s = init();
    expect(currentFocus(s)).toBeNull();
    expect(walkedPath(s)).toEqual([]);
  });

  it("shift sets current focus", () => {
    const s = shift(init(), "Memory", 100);
    expect(currentFocus(s)).toBe("Memory");
    expect(walkedPath(s)).toEqual(["Memory"]);
  });

  it("shifting to the same sigil is a no-op", () => {
    const s1 = shift(init(), "Memory", 100);
    const s2 = shift(s1, "Memory", 200);
    expect(s2).toBe(s1);
  });

  it("shifting to a different sigil pushes the previous to trajectory", () => {
    let s = init();
    s = shift(s, "Memory", 100);
    s = shift(s, "Path", 200);
    expect(currentFocus(s)).toBe("Path");
    expect(walkedPath(s)).toEqual(["Memory", "Path"]);
    expect(s.trajectory).toHaveLength(1);
    expect(s.trajectory[0].sigilName).toBe("Memory");
  });

  it("anchorTo rides with the user's focus", () => {
    let s = init();
    s = anchorTo(s, "Workspace", 100);
    expect(currentFocus(s)).toBe("Workspace");
    s = anchorTo(s, "Atlas", 200);
    expect(currentFocus(s)).toBe("Atlas");
    expect(walkedPath(s)).toEqual(["Workspace", "Atlas"]);
  });

  it("shift overrides a prior anchor within the same tick — anchored but not bound", () => {
    let s = init();
    s = anchorTo(s, "Workspace", 100);
    s = shift(s, "Memory", 150); // attraction pulls him elsewhere
    expect(currentFocus(s)).toBe("Memory");
    expect(walkedPath(s)).toEqual(["Workspace", "Memory"]);
  });

  it("trajectory is capped", () => {
    let s = init();
    for (let i = 0; i < 40; i++) s = shift(s, `Sigil${i}`, i);
    expect(s.trajectory.length).toBeLessThanOrEqual(32);
    expect(currentFocus(s)).toBe("Sigil39");
  });
});
