import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { detectOutgrownPlacements } from "../../packages/sigil-core/src/outgrownPlacement";

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
  isImported?: boolean;
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
    isImported: opts?.isImported,
  };
}

describe("detectOutgrownPlacements", () => {
  it("returns empty when no sigil has external attendants", () => {
    const root = sigil("Root", {
      children: [
        sigil("Alpha", { language: "I mention @Beta." }),
        sigil("Beta"),
      ],
    });
    expect(detectOutgrownPlacements(root)).toEqual([]);
  });

  it("fires when a local child is attended from many sigils outside its parent", () => {
    // @Attention sits inside @Coherent, but is referenced by @Focus and @Memory,
    // both of which are children of Root. Attention wants to rise to Root.
    const root = sigil("Root", {
      children: [
        sigil("Coherent", {
          children: [
            sigil("Attention", { language: "I am a quality of noticing." }),
          ],
        }),
        sigil("Focus", { language: "I depend on @Attention." }),
        sigil("Memory", { language: "I rely on @Attention." }),
      ],
    });
    const placements = detectOutgrownPlacements(root);
    expect(placements).toHaveLength(1);
    const p = placements[0];
    expect(p.path).toEqual(["Coherent", "Attention"]);
    expect(p.currentParent).toEqual(["Coherent"]);
    expect(p.optimalParent).toEqual([]);
    expect(p.optimalParentName).toBe("Root");
    expect(p.attendants).toHaveLength(2);
  });

  it("does not fire when the sigil's placement already matches its attendants", () => {
    // @Shared lives under @Parent, and is only referenced by @Parent's other
    // children. Its current placement is already the DCA.
    const root = sigil("Root", {
      children: [
        sigil("Parent", {
          children: [
            sigil("Shared"),
            sigil("A", { language: "I use @Shared." }),
            sigil("B", { language: "I use @Shared." }),
          ],
        }),
      ],
    });
    expect(detectOutgrownPlacements(root)).toEqual([]);
  });

  it("ignores references from inside the sigil's own subtree", () => {
    // @Inner sits under @Outer. Its only attendant is @Outer/Inner/Child.
    // That attendant is inside @Inner's subtree, so it does not pull outward.
    const root = sigil("Root", {
      children: [
        sigil("Outer", {
          children: [
            sigil("Inner", {
              children: [
                sigil("Child", { language: "I reference @Inner from inside." }),
                sigil("Sibling", { language: "Also mentioning @Inner here." }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(detectOutgrownPlacements(root)).toEqual([]);
  });

  it("respects the minimum-attendants threshold", () => {
    // One external reference is too weak.
    const root = sigil("Root", {
      children: [
        sigil("Coherent", {
          children: [sigil("Attention")],
        }),
        sigil("Focus", { language: "I depend on @Attention." }),
      ],
    });
    expect(detectOutgrownPlacements(root)).toEqual([]);
  });

  it("rises to the deepest common ancestor, not all the way to root", () => {
    // @Shared is nested deeply under @A/@B. Its attendants all live under @A.
    // It should want to rise to @A, not root.
    const root = sigil("Root", {
      children: [
        sigil("A", {
          children: [
            sigil("B", {
              children: [sigil("Shared")],
            }),
            sigil("X", { language: "I use @Shared." }),
            sigil("Y", { language: "I use @Shared." }),
          ],
        }),
        sigil("Z", { language: "Unrelated." }),
      ],
    });
    const placements = detectOutgrownPlacements(root);
    expect(placements).toHaveLength(1);
    expect(placements[0].path).toEqual(["A", "B", "Shared"]);
    expect(placements[0].optimalParent).toEqual(["A"]);
    expect(placements[0].optimalParentName).toBe("A");
  });

  it("vetoes a structurally-justified rise when embedding anchors the sigil deeper", () => {
    // @Time sits under @Attention. External attendants (outside @Attention)
    // structurally pull it to root. But @Time's embedding companions live
    // inside @Attention — @Timelike, @Spacelike, @Observer. The rise would
    // strand @Time from its companions, so the sense holds it back.
    const root = sigil("Root", {
      children: [
        sigil("Attention", {
          language: [
            "I attend @Timelike and I attend @Spacelike: @Time has two flavors.",
            "@Time and @Observer meet: the @Observer walks through @Time.",
            "@Timelike @Time is what @Narrative compresses.",
            "@Spacelike @Time is what @Frame holds.",
          ].join("\n"),
          children: [
            sigil("Time"),
            sigil("Timelike"),
            sigil("Spacelike"),
            sigil("Observer"),
            sigil("Narrative"),
            sigil("Frame"),
          ],
        }),
        // External attendants would normally pull @Time to root.
        sigil("User", { language: "I measure by @Time." }),
        sigil("Workspace", { language: "I stamp each change with @Time." }),
        sigil("DesignPartner", { language: "I narrate in @Time." }),
      ],
    });
    // With the anchor check enabled (default), the rise is suppressed.
    expect(detectOutgrownPlacements(root)).toEqual([]);
    // With the anchor check skipped, the raw structural pull is visible.
    const raw = detectOutgrownPlacements(root, null, { skipAnchorCheck: true });
    expect(raw).toHaveLength(1);
    expect(raw[0].path).toEqual(["Attention", "Time"]);
    expect(raw[0].optimalParent).toEqual([]);
  });

  it("does not fire when attendants force a lateral move (not strictly up)", () => {
    // @Shared sits at A/Shared. Its attendants live at B/X and B/Y.
    // DCA of attendants is B — but B is not an ancestor of A (current parent).
    // We only fire for strictly-upward rises, not sideways migrations.
    const root = sigil("Root", {
      children: [
        sigil("A", { children: [sigil("Shared")] }),
        sigil("B", {
          children: [
            sigil("X", { language: "I use @Shared." }),
            sigil("Y", { language: "I use @Shared." }),
          ],
        }),
      ],
    });
    // DCA of attendants = B. Current parent = A. B is not an ancestor of A,
    // so we don't fire. (The sigil may still want to move, but this sense
    // speaks only to vertical rise.)
    const placements = detectOutgrownPlacements(root);
    // Accept either: flags with optimalParent = root, or does not fire.
    // The current rule fires when dca is a proper ancestor of currentParent.
    // DCA = ["B"], currentParent = ["A"]. ["B"] is not ancestor of ["A"].
    // → no fire.
    expect(placements).toEqual([]);
  });
});
