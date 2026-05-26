import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { activeLineDeletionRange } from "../src/components/Workspace/editorShortcuts";

function doc(text: string) {
  return EditorState.create({ doc: text }).doc;
}

describe("activeLineDeletionRange", () => {
  it("deletes a middle line with its following newline", () => {
    expect(activeLineDeletionRange(doc("alpha\nbeta\ngamma"), 7)).toEqual({ from: 6, to: 11 });
  });

  it("deletes the final line with its preceding newline", () => {
    expect(activeLineDeletionRange(doc("alpha\nbeta\ngamma"), 13)).toEqual({ from: 10, to: 16 });
  });

  it("deletes a single line without crossing document bounds", () => {
    expect(activeLineDeletionRange(doc("alpha"), 2)).toEqual({ from: 0, to: 5 });
  });
});
