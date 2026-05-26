import { describe, expect, it } from "vitest";
import type { RenameSigilResult } from "../../../src/actions/workspace";
import { currentPathAfterRename } from "../../../src/components/Workspace/renamePath";

function renameResult(overrides?: Partial<RenameSigilResult>): RenameSigilResult {
  return {
    oldName: "Old",
    newName: "New",
    oldPath: "/mock/App/Old",
    newPath: "/mock/App/New",
    filesUpdated: 0,
    ...overrides,
  };
}

describe("currentPathAfterRename", () => {
  it("updates the selected local sigil path", () => {
    expect(currentPathAfterRename(["Old"], "/mock/App/Old", renameResult())).toEqual(["New"]);
  });

  it("updates a selected descendant under a renamed local sigil", () => {
    expect(currentPathAfterRename(
      ["Parent", "Old", "Child"],
      "/mock/App/Parent/Old/Child",
      renameResult({
        oldPath: "/mock/App/Parent/Old",
        newPath: "/mock/App/Parent/New",
      }),
    )).toEqual(["Parent", "New", "Child"]);
  });

  it("updates the selected imported ontology path", () => {
    expect(currentPathAfterRename(
      ["Imported Ontologies", "AttentionLanguage", "Old"],
      "/mock/App/Libs/AttentionLanguage/Old",
      renameResult({
        oldPath: "/mock/App/Libs/AttentionLanguage/Old",
        newPath: "/mock/App/Libs/AttentionLanguage/New",
      }),
    )).toEqual(["Imported Ontologies", "AttentionLanguage", "New"]);
  });

  it("updates a selected descendant under a renamed imported ontology sigil", () => {
    expect(currentPathAfterRename(
      ["Imported Ontologies", "AttentionLanguage", "Parent", "Old", "Child"],
      "/mock/App/Libs/AttentionLanguage/Parent/Old/Child",
      renameResult({
        oldPath: "/mock/App/Libs/AttentionLanguage/Parent/Old",
        newPath: "/mock/App/Libs/AttentionLanguage/Parent/New",
      }),
    )).toEqual(["Imported Ontologies", "AttentionLanguage", "Parent", "New", "Child"]);
  });

  it("leaves an unrelated selection unchanged", () => {
    expect(currentPathAfterRename(["Other"], "/mock/App/Other", renameResult())).toBeNull();
  });

  it("does not guess when the selected filesystem path is unavailable", () => {
    expect(currentPathAfterRename(["Old"], null, renameResult())).toBeNull();
  });

  it("does not guess when rename failed", () => {
    expect(currentPathAfterRename(["Old"], "/mock/App/Old", null)).toBeNull();
  });

  it("handles trailing slashes in filesystem paths", () => {
    expect(currentPathAfterRename(
      ["Old", "Child"],
      "/mock/App/Old/Child/",
      renameResult({ oldPath: "/mock/App/Old/" }),
    )).toEqual(["New", "Child"]);
  });

  it("does not guess when the UI path is shorter than the filesystem descendant path", () => {
    expect(currentPathAfterRename(
      ["Old"],
      "/mock/App/Old/Child",
      renameResult(),
    )).toBeNull();
  });
});
