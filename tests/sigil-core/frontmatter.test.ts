import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "../../packages/sigil-core/src/frontmatter";

describe("stripFrontmatter", () => {
  it("strips valid frontmatter", () => {
    const input = "---\ntitle: Test\nstatus: draft\n---\nContent here.";
    expect(stripFrontmatter(input)).toBe("Content here.");
  });

  it("returns content unchanged when no frontmatter", () => {
    const input = "Just plain content.";
    expect(stripFrontmatter(input)).toBe("Just plain content.");
  });

  it("returns content unchanged when no closing ---", () => {
    const input = "---\ntitle: Test\nThis never closes.";
    expect(stripFrontmatter(input)).toBe("---\ntitle: Test\nThis never closes.");
  });

  it("handles empty content after frontmatter", () => {
    const input = "---\ntitle: X\n---\n";
    expect(stripFrontmatter(input)).toBe("");
  });

  it("preserves content that starts with --- but has more text", () => {
    const input = "---\nkey: value\n---\n\nParagraph one.\n\nParagraph two.";
    const result = stripFrontmatter(input);
    expect(result).toContain("Paragraph one.");
    expect(result).toContain("Paragraph two.");
  });
});
