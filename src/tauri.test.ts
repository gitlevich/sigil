import { describe, it, expect } from "vitest";
import { toTauriAccelerator, menuAccelerator, toDisplayShortcut } from "./tauri";

describe("toTauriAccelerator", () => {
  it("converts simple Mod shortcut", () => {
    expect(toTauriAccelerator("Mod-e")).toBe("CmdOrCtrl+E");
  });

  it("converts Alt-Mod combo with correct modifier order", () => {
    expect(toTauriAccelerator("Alt-Mod-r")).toBe("CmdOrCtrl+Alt+R");
  });

  it("converts Mod-Alt combo (reversed input order)", () => {
    expect(toTauriAccelerator("Mod-Alt-r")).toBe("CmdOrCtrl+Alt+R");
  });

  it("converts Alt-only shortcut", () => {
    expect(toTauriAccelerator("Alt-z")).toBe("Alt+Z");
  });

  it("converts Shift-Mod combo", () => {
    expect(toTauriAccelerator("Mod-Shift-s")).toBe("CmdOrCtrl+Shift+S");
  });

  it("preserves multi-char key names", () => {
    expect(toTauriAccelerator("Mod-Enter")).toBe("CmdOrCtrl+Enter");
  });

  it("handles three modifiers", () => {
    expect(toTauriAccelerator("Alt-Shift-Mod-x")).toBe("CmdOrCtrl+Alt+Shift+X");
  });
});

describe("menuAccelerator", () => {
  it("returns accelerator for non-Alt shortcuts", () => {
    const result = menuAccelerator("Export...", "Mod-e");
    expect(result.accelerator).toBe("CmdOrCtrl+E");
    expect(result.text).toBe("Export...");
  });

  // On non-Mac (CI), Alt shortcuts still get native accelerator
  // On Mac, they get text hint instead — tested manually
  it("returns text and accelerator keys for Alt shortcuts", () => {
    const result = menuAccelerator("Rename Sigil...", "Alt-Mod-r");
    // Either has accelerator (non-Mac) or has hint in text (Mac)
    if (result.accelerator) {
      expect(result.accelerator).toBe("CmdOrCtrl+Alt+R");
      expect(result.text).toBe("Rename Sigil...");
    } else {
      expect(result.text).toContain("Rename Sigil...");
      expect(result.text).toContain("Option+Cmd+R");
    }
  });
});

describe("toDisplayShortcut", () => {
  it("converts Alt-Mod-r for display (non-Mac in Node)", () => {
    // In Node (no navigator), isMac is false → Ctrl/Alt labels
    expect(toDisplayShortcut("Alt-Mod-r")).toBe("Alt+Ctrl+R");
  });

  it("converts simple shortcut", () => {
    expect(toDisplayShortcut("Mod-e")).toBe("Ctrl+E");
  });
});
