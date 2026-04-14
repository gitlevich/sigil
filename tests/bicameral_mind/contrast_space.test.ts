import { describe, it, expect } from "vitest";
import type { Sigil } from "sigil-core";
import {
  createContrastSpace,
  place,
  neighbors,
  displacement,
  inhabit,
  distance,
} from "../../src/bicameral_mind/right_hemisphere/co_occurrence_geometry/contrast_space";

function sigil(name: string, language: string, children: Sigil[] = []): Sigil {
  return { name, language, affordances: [], invariants: [], children };
}

describe("ContrastSpace", () => {
  const root = sigil("Root", "@Alpha and @Beta work together. @Alpha uses @Gamma.", [
    sigil("Alpha", "I reference @Beta here."),
    sigil("Beta", ""),
    sigil("Gamma", ""),
  ]);

  it("place creates Positions for every non-imported sigil", () => {
    const space = place(createContrastSpace(), root);
    expect(space.positions.has("Root")).toBe(true);
    expect(space.positions.has("Alpha")).toBe(true);
    expect(space.positions.has("Beta")).toBe(true);
    expect(space.positions.has("Gamma")).toBe(true);
  });

  it("Positions carry vocabulary", () => {
    const rootWithAffordances = {
      ...root,
      children: [
        {
          ...sigil("Alpha", ""),
          affordances: [{ name: "do-thing", content: "does a thing" }],
          invariants: [{ name: "must-hold", content: "always true" }],
        },
        sigil("Beta", ""),
        sigil("Gamma", ""),
      ],
    };
    const space = place(createContrastSpace(), rootWithAffordances);
    const alpha = space.positions.get("Alpha")!;
    expect(alpha.affordances).toHaveLength(1);
    expect(alpha.invariants).toHaveLength(1);
  });

  it("co-occurring sigils are closer than non-co-occurring ones", () => {
    // Alpha+Beta co-occur twice, Alpha+Gamma only once
    const tree = sigil(
      "Root",
      "@Alpha and @Beta here. @Alpha and @Beta again. @Alpha and @Gamma once.",
      [sigil("Alpha", ""), sigil("Beta", ""), sigil("Gamma", "")],
    );
    const space = place(createContrastSpace(), tree);
    const alpha = space.positions.get("Alpha")!;
    const beta = space.positions.get("Beta")!;
    const gamma = space.positions.get("Gamma")!;

    const alphaBetaDist = distance(alpha, beta);
    const alphaGammaDist = distance(alpha, gamma);
    expect(alphaBetaDist).toBeLessThan(alphaGammaDist);
  });

  it("neighbors returns closest Positions", () => {
    const space = place(createContrastSpace(), root);
    const alpha = space.positions.get("Alpha")!;
    const nearest = neighbors(space, alpha, 2);
    expect(nearest).toHaveLength(2);
    // Beta should be nearest to Alpha (more co-occurrences)
    expect(nearest[0].name).toBe("Beta");
  });

  it("displacement returns null before second place", () => {
    const space = place(createContrastSpace(), root);
    expect(displacement(space, "Alpha")).toBeNull();
  });

  it("displacement detects change after second place", () => {
    const space1 = place(createContrastSpace(), root);
    // Modify the tree — add a co-occurrence that didn't exist before
    const modifiedRoot = sigil(
      "Root",
      "@Alpha and @Beta work together. @Beta and @Gamma now linked.",
      [sigil("Alpha", ""), sigil("Beta", ""), sigil("Gamma", "")],
    );
    const space2 = place(space1, modifiedRoot);
    const betaShift = displacement(space2, "Beta");
    expect(betaShift).not.toBeNull();
    expect(betaShift!).toBeGreaterThan(0);
  });

  it("displacement is zero when nothing changes", () => {
    const space1 = place(createContrastSpace(), root);
    const space2 = place(space1, root);
    const shift = displacement(space2, "Alpha");
    expect(shift).toBe(0);
  });

  it("inhabit sets the inhabited sigil", () => {
    const space = inhabit(place(createContrastSpace(), root), "Alpha");
    expect(space.inhabitedSigil).not.toBeNull();
    expect(space.inhabitedSigil!.position.name).toBe("Alpha");
  });

  it("inhabit with unknown name is a no-op", () => {
    const space = inhabit(place(createContrastSpace(), root), "Nonexistent");
    expect(space.inhabitedSigil).toBeNull();
  });

  it("inhabited sigil is singular — inhabiting another replaces it", () => {
    let space = place(createContrastSpace(), root);
    space = inhabit(space, "Alpha");
    space = inhabit(space, "Beta");
    expect(space.inhabitedSigil!.position.name).toBe("Beta");
  });
});
