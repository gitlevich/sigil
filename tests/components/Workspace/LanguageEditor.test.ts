/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/tauri", () => ({
  api: { writeImageBytes: vi.fn().mockResolvedValue(""), readFile: vi.fn().mockResolvedValue(""), readSigil: vi.fn() },
  events: {
    onSelectText: vi.fn().mockResolvedValue(() => {}),
    onReplaceSelectedText: vi.fn().mockResolvedValue(() => {}),
  },
}));

import { isImageFile } from "../../../src/components/Workspace/LanguageEditor";

describe("isImageFile", () => {
  it("recognizes png", () => expect(isImageFile("photo.png")).toBe(true));
  it("recognizes jpg", () => expect(isImageFile("photo.jpg")).toBe(true));
  it("recognizes jpeg", () => expect(isImageFile("photo.jpeg")).toBe(true));
  it("recognizes gif", () => expect(isImageFile("anim.gif")).toBe(true));
  it("recognizes svg", () => expect(isImageFile("icon.svg")).toBe(true));
  it("recognizes webp", () => expect(isImageFile("image.webp")).toBe(true));
  it("case insensitive", () => expect(isImageFile("PHOTO.PNG")).toBe(true));
  it("rejects markdown", () => expect(isImageFile("doc.md")).toBe(false));
  it("rejects text", () => expect(isImageFile("readme.txt")).toBe(false));
  it("rejects no extension", () => expect(isImageFile("noext")).toBe(false));
  it("handles dot-only filename", () => expect(isImageFile(".png")).toBe(true));
});
