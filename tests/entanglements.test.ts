import { describe, it, expect } from "vitest";
import { extractEntanglements } from "../src/lib/entanglements";
import type { Sigil } from "sigil-core";

function sigil(name: string, children: Sigil[] = [], language = ""): Sigil {
  return { name, language, affordances: [], invariants: [], children };
}

describe("extractEntanglements", () => {
  it("returns absolute paths for siblings in the main spec", () => {
    const main = sigil("Root", [
      sigil("Beauty"),
      sigil("Truth"),
    ]);
    const ents = extractEntanglements(
      "I bow to @Truth in passing.",
      main,
      ["Beauty"],
      null,
      [],
    );
    expect(ents).toEqual([{ name: "Truth", kind: "neighbor", path: ["Truth"] }]);
  });

  it("prepends Imported Ontologies to neighbor paths when inhabited inside imports", () => {
    const imported = sigil("Imported Ontologies", [
      sigil("AttentionLanguage", [
        sigil("Beauty", [], "I name @Love as my orientation."),
        sigil("Love"),
      ]),
    ]);
    const inside = imported.children[0]; // AttentionLanguage subtree as @user sees it

    const ents = extractEntanglements(
      "I name @Love as my orientation.",
      inside,            // resolver root: scope-local
      ["Beauty"],        // scope-local current path
      inside,            // imported ontologies arg
      [],
      ["Imported Ontologies", "AttentionLanguage"],
    );

    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({
      name: "Love",
      kind: "neighbor",
      path: ["Imported Ontologies", "AttentionLanguage", "Love"],
    });
  });

  it("returns absolute landmark (proximity) paths in the main spec", () => {
    const main = sigil("Root", [
      sigil("Speaker", [], "I gesture at @Beauty far away."),
      sigil("Aesthetics", [
        sigil("Beauty"),
      ]),
    ]);

    const ents = extractEntanglements(
      "I gesture at @Beauty far away.",
      main,
      ["Speaker"],
      null,
      [],
    );

    const beauty = ents.find((e) => e.name === "Beauty");
    expect(beauty).toBeDefined();
    expect(beauty!.kind).toBe("landmark");
    expect(beauty!.path).toEqual(["Aesthetics", "Beauty"]);
  });
});
