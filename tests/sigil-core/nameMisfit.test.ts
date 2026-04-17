import { describe, it, expect } from "vitest";
import type { Sigil } from "../../packages/sigil-core/src/types";
import { detectNameMisfits } from "../../packages/sigil-core/src/nameMisfit";

function sigil(name: string, opts?: {
  language?: string;
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  children?: Sigil[];
  isImported?: boolean;
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [],
    children: opts?.children ?? [],
    isImported: opts?.isImported,
  };
}

describe("detectNameMisfits", () => {
  it("returns empty list when a ref has no line-mates", () => {
    const root = sigil("Root", {
      children: [
        sigil("Alpha", { language: "I mention @Beta only." }),
        sigil("Beta"),
      ],
    });
    expect(detectNameMisfits(root)).toEqual([]);
  });

  it("returns empty list when every pair co-occurs multiply across the spec", () => {
    // Fully symmetric: Alpha, Beta, Gamma all pair with each other 3 times.
    // Every line sits in a well-populated neighborhood; nothing looks off.
    const trio = ["I mention @Beta and @Gamma.", "I mention @Beta and @Gamma.", "I mention @Beta and @Gamma."].join("\n");
    const root = sigil("Root", {
      children: [
        sigil("Alpha", { language: trio }),
        sigil("Beta", {
          language: ["I mention @Alpha and @Gamma.", "I mention @Alpha and @Gamma.", "I mention @Alpha and @Gamma."].join("\n"),
        }),
        sigil("Gamma", {
          language: ["I mention @Alpha and @Beta.", "I mention @Alpha and @Beta.", "I mention @Alpha and @Beta."].join("\n"),
        }),
      ],
    });
    expect(detectNameMisfits(root)).toEqual([]);
  });

  it("flags a resolved ref placed with a stranger when it has a stable companion elsewhere", () => {
    // @Metric appears 3 times alongside @Companion — a stable established
    // neighborhood. A final line in @Stranger puts @Metric next to @Zeta,
    // which @Metric has never co-occurred with. @Metric should be flagged:
    // well-placed elsewhere, out of place here.
    const root = sigil("Root", {
      children: [
        sigil("Metric"),
        sigil("Companion"),
        sigil("Zeta"),
        sigil("A", {
          language: "I reference @Metric with @Companion. Again: @Metric with @Companion.",
        }),
        sigil("B", {
          language: "I reference @Metric with @Companion.",
        }),
        sigil("Stranger", {
          language: "Here I mistakenly write @Metric and @Zeta together.",
        }),
      ],
    });
    const misfits = detectNameMisfits(root);
    const metricMisfit = misfits.find(m => m.resolvedTo === "Metric" && m.path[0] === "Stranger");
    expect(metricMisfit).toBeDefined();
    expect(metricMisfit!.file).toBe("language.md");
    expect(metricMisfit!.neighborhood).toContain("Zeta");
    expect(metricMisfit!.reason).toContain("usually appears with");
    expect(metricMisfit!.reason).toContain("@Companion");
  });

  it("does not flag a freshly introduced sigil with no prior co-occurrences", () => {
    // @Fresh has total external edge count 0 and no stable companion.
    // Introducing it alongside @Other should not fire — the detector only
    // flags well-connected sigils placed out of neighborhood.
    const root = sigil("Root", {
      children: [
        sigil("Fresh"),
        sigil("Other"),
        sigil("Intro", {
          language: "Here I introduce @Fresh alongside @Other for the first time.",
        }),
      ],
    });
    expect(detectNameMisfits(root)).toEqual([]);
  });

  it("does not flag when a companion is merely novel (only one external co-occurrence)", () => {
    // @X and @Y co-occur exactly once elsewhere. Novel but not established.
    // The detector should stay quiet — there's no stable pattern to depart
    // from, so a new pairing isn't suspicious.
    const root = sigil("Root", {
      children: [
        sigil("X"),
        sigil("Y"),
        sigil("Z"),
        sigil("Intro", {
          language: "I introduce @X and @Y once.",
        }),
        sigil("Another", {
          language: "I mention @X and @Z.",
        }),
      ],
    });
    expect(detectNameMisfits(root)).toEqual([]);
  });

  it("ignores refs inside inline code spans", () => {
    // @Metric has a stable companion in @Companion. Even if code span mentions
    // @Metric with @Zeta, it should not be extracted or tested.
    const root = sigil("Root", {
      children: [
        sigil("Metric"),
        sigil("Companion"),
        sigil("Zeta"),
        sigil("A", {
          language: "I reference @Metric with @Companion. Again: @Metric with @Companion.",
        }),
        sigil("B", {
          language: "I reference @Metric with @Companion.",
        }),
        sigil("Stranger", {
          language: "In code: `@Metric and @Zeta` — should not count.",
        }),
      ],
    });
    const misfits = detectNameMisfits(root);
    expect(misfits.find(m => m.neighborhood.includes("Zeta"))).toBeUndefined();
  });

  it("reports accurate line numbers", () => {
    const root = sigil("Root", {
      children: [
        sigil("Metric"),
        sigil("Companion"),
        sigil("Zeta"),
        sigil("A", {
          language: "I reference @Metric with @Companion. Again: @Metric with @Companion.",
        }),
        sigil("B", {
          language: "I reference @Metric with @Companion.",
        }),
        sigil("Stranger", {
          language: ["", "", "Third line: @Metric and @Zeta."].join("\n"),
        }),
      ],
    });
    const misfits = detectNameMisfits(root);
    const metricMisfit = misfits.find(m => m.resolvedTo === "Metric" && m.path[0] === "Stranger");
    expect(metricMisfit!.line).toBe(3);
  });
});
