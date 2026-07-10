/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { matchesKeybinding } from "sigil-core/keybinding";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchesKeybinding", () => {
  it("matches Shift-Command-F", () => {
    expect(matchesKeybinding(
      keyEvent({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }),
      "Shift-Mod-f",
    )).toBe(true);
  });

  it("rejects the binding when Shift is absent", () => {
    expect(matchesKeybinding(
      keyEvent({ key: "f", code: "KeyF", metaKey: true }),
      "Shift-Mod-f",
    )).toBe(false);
  });

  it("accepts Control as Mod on non-Mac platforms", () => {
    expect(matchesKeybinding(
      keyEvent({ key: "f", code: "KeyF", ctrlKey: true, shiftKey: true }),
      "Shift-Mod-f",
    )).toBe(true);
  });

  it("uses physical bracket identity when Option changes the character", () => {
    expect(matchesKeybinding(
      keyEvent({ key: "å", code: "BracketLeft", altKey: true }),
      "Alt-[",
    )).toBe(true);
  });
});
