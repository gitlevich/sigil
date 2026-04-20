import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { build as buildSigilSpace } from "../../packages/sigil-core/src/sigilSpace";
import { isEmergenceAnchored } from "../../packages/sigil-core/src/emergenceAnchor";

function sigil(name: string, opts?: { language?: string; children?: Sigil[] }): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
  };
}

describe("isEmergenceAnchored", () => {
  it("returns false when the sigil has no embedding evidence", () => {
    const root = sigil("Root", {
      children: [
        sigil("Noise", { children: [sigil("Narrative"), sigil("Spacelike")] }),
      ],
    });
    const space = buildSigilSpace(root, null);
    expect(isEmergenceAnchored(space, root, ["Noise", "Narrative"], [])).toBe(false);
  });

  it("returns false when the sigil has no siblings", () => {
    const root = sigil("Root", {
      children: [
        sigil("Noise", {
          language: "@Narrative and @Attention walk together.",
          children: [sigil("Narrative")],
        }),
        sigil("Attention", { language: "I touch @Narrative." }),
      ],
    });
    const space = buildSigilSpace(root, null);
    expect(isEmergenceAnchored(space, root, ["Noise", "Narrative"], [])).toBe(false);
  });

  it("vetoes the rise when sibling co-occurrence mass reaches the threshold", () => {
    // @Narrative shares sentences with @Spacelike, @Timelike, @Coherent —
    // all direct siblings. That neighborhood is its companions; the rise
    // would strand it.
    const root = sigil("Root", {
      children: [
        sigil("Noise", {
          language: [
            "Random @spacelike information not enough to reconstitute a @coherent @narrative @timelike.",
            "A @narrative compresses @spacelike into @timelike through @coherent attention.",
          ].join("\n"),
          children: [
            sigil("Narrative"),
            sigil("Spacelike"),
            sigil("Timelike"),
            sigil("Coherent"),
          ],
        }),
        sigil("Attention", { language: "@attention touches @narrative." }),
        sigil("Sigil", { language: "a @sigil holds a @narrative." }),
      ],
    });
    const space = buildSigilSpace(root, null);
    expect(isEmergenceAnchored(space, root, ["Noise", "Narrative"], [])).toBe(true);
  });

  it("does not veto when siblings are strangers in the embedding", () => {
    // @Shared lives under @Coherent with siblings @Alpha and @Beta, but
    // never co-occurs with them — its companions are elsewhere (@Focus,
    // @Memory). The sibling neighborhood is nominal only; rise proceeds.
    const root = sigil("Root", {
      children: [
        sigil("Coherent", {
          children: [
            sigil("Shared"),
            sigil("Alpha"),
            sigil("Beta"),
          ],
        }),
        sigil("Focus", {
          language: "I need @Shared and I need @Memory together to work.",
        }),
        sigil("Memory", {
          language: "I require @Shared and @Focus together in all my reads.",
        }),
      ],
    });
    const space = buildSigilSpace(root, null);
    expect(isEmergenceAnchored(space, root, ["Coherent", "Shared"], [])).toBe(false);
  });
});
