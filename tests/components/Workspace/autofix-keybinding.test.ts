/**
 * Tests that Alt+Enter (autofix) is not swallowed by other keydown handlers.
 *
 * The PropertyCodeMirror Enter handler must exclude Alt+Enter so
 * buildPropertyExtensions' auto-fix handler can fire.
 * The VisionEditor must also handle Alt+Enter for autofix.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../../..");

describe("Alt+Enter autofix keybinding", () => {
  describe("PropertyCodeMirror in SigilPropertyEditor", () => {
    const source = readFileSync(
      resolve(root, "src/components/Workspace/SigilPropertyEditor.tsx"),
      "utf-8",
    );

    it("Enter handler excludes altKey to allow autofix passthrough", () => {
      // The keydown handler for Enter must check !event.altKey
      // so Alt+Enter reaches buildPropertyExtensions instead of committing.
      expect(source).toContain('!event.altKey');
      // Verify the full guard condition
      expect(source).toMatch(/event\.key === "Enter" && !event\.shiftKey && !event\.altKey/);
    });

    it("still commits on plain Enter", () => {
      // The handler must still call onCommitRef.current() on plain Enter
      expect(source).toContain('onCommitRef.current()');
    });
  });

  describe("VisionEditor", () => {
    const source = readFileSync(
      resolve(root, "src/components/OntologyTree/VisionEditor.tsx"),
      "utf-8",
    );

    it("imports findPropertyRefAtCursor for affordance/invariant autofix", () => {
      expect(source).toContain("findPropertyRefAtCursor");
    });

    it("imports findRefAtCursor for sigil autofix", () => {
      expect(source).toContain("findRefAtCursor");
    });

    it("handles Alt+Enter keydown", () => {
      expect(source).toMatch(/event\.altKey && event\.key === "Enter"/);
    });

    it("creates affordances via actions.createAffordance", () => {
      expect(source).toContain("actions.createAffordance");
    });

    it("creates invariants via actions.createInvariant", () => {
      expect(source).toContain("actions.createInvariant");
    });

    it("creates sigils via actions.createSigil", () => {
      expect(source).toContain("actions.createSigil");
    });

    it("wires reference autocomplete in edit mode", () => {
      expect(source).toContain("autocompletion({");
      expect(source).toContain("override: [scopeCompletion]");
      expect(source).toContain("activateOnTyping: true");
    });
  });
});
