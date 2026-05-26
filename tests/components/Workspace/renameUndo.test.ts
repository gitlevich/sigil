import { describe, expect, it, vi } from "vitest";
import { recordCompletedRename, undoLastRename } from "../../../src/components/Workspace/renameUndo";
import type { RenameSigilResult } from "../../../src/actions/workspace";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function renameResult(overrides?: Partial<RenameSigilResult>): RenameSigilResult {
  return {
    oldName: "Entanglement",
    newName: "EntanglementTTTT",
    oldPath: "/mock/App/Libs/AttentionLanguage/Entanglement",
    newPath: "/mock/App/Libs/AttentionLanguage/EntanglementTTTT",
    filesUpdated: 4,
    ...overrides,
  };
}

describe("rename undo stack", () => {
  it("records completed renames when not already undoing", () => {
    const stack = { current: [] as RenameSigilResult[] };
    const undoing = { current: false };
    const result = renameResult();

    recordCompletedRename(stack, result, undoing);

    expect(stack.current).toEqual([result]);
  });

  it("does not record null results or undo-generated renames", () => {
    const stack = { current: [] as RenameSigilResult[] };
    const undoing = { current: true };

    recordCompletedRename(stack, renameResult(), undoing);
    undoing.current = false;
    recordCompletedRename(stack, null, undoing);

    expect(stack.current).toEqual([]);
  });

  it("undoes the last rename by renaming the new path back to the old name", async () => {
    const result = renameResult();
    const stack = { current: [result] };
    const undoing = { current: false };
    const rename = vi.fn().mockResolvedValue(renameResult({
      oldName: "EntanglementTTTT",
      newName: "Entanglement",
      oldPath: result.newPath,
      newPath: result.oldPath,
    }));

    expect(undoLastRename(stack, undoing, rename)).toBe(true);
    expect(rename).toHaveBeenCalledWith(result.newPath, result.oldName);
    expect(undoing.current).toBe(true);
    await settle();
    expect(stack.current).toEqual([]);
    expect(undoing.current).toBe(false);
  });

  it("restores the undo entry when the reverse rename fails", async () => {
    const result = renameResult();
    const stack = { current: [result] };
    const undoing = { current: false };
    const rename = vi.fn().mockResolvedValue(null);

    expect(undoLastRename(stack, undoing, rename)).toBe(true);
    await settle();

    expect(stack.current).toEqual([result]);
    expect(undoing.current).toBe(false);
  });

  it("returns false when there is no rename to undo", () => {
    const stack = { current: [] as RenameSigilResult[] };
    const undoing = { current: false };

    expect(undoLastRename(stack, undoing, vi.fn())).toBe(false);
    expect(undoing.current).toBe(false);
  });
});
