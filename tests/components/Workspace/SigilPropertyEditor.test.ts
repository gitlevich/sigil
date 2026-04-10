import { describe, it, expect } from "vitest";
import { getDragPropertySource, clearDragPropertySource, slugify } from "../../../src/components/Workspace/SigilPropertyEditor";

describe("getDragPropertySource / clearDragPropertySource", () => {
  it("returns null initially", () => expect(getDragPropertySource()).toBeNull());
  it("returns null after clearing", () => { clearDragPropertySource(); expect(getDragPropertySource()).toBeNull(); });
});

describe("slugify", () => {
  it("replaces spaces with hyphens", () => expect(slugify("hello world")).toBe("hello-world"));
  it("handles multiple spaces", () => expect(slugify("a  b   c")).toBe("a-b-c"));
  it("trims whitespace", () => expect(slugify("  padded  ")).toBe("padded"));
  it("returns empty for whitespace-only", () => expect(slugify("   ")).toBe(""));
  it("preserves existing hyphens", () => expect(slugify("already-dashed")).toBe("already-dashed"));
  it("handles tabs and newlines", () => expect(slugify("a\tb\nc")).toBe("a-b-c"));
});
