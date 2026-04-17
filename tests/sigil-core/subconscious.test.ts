import { describe, it, expect } from "vitest";
import {
  consultSpellbook,
  emptySpellbook,
  type Disturbance,
  type Spell,
  type Spellbook,
} from "../../packages/sigil-core/src/subconscious";

function disturbance(kind: string, payload: unknown = {}): Disturbance {
  return { kind, payload };
}

function spell(name: string, kindMatched: string, succeeds = true): Spell {
  return {
    name,
    situation: `matches ${kindMatched}`,
    matches: (d) => d.kind === kindMatched,
    cast: () => succeeds
      ? { success: true, summary: `cast ${name}` }
      : { success: false, summary: `${name} failed` },
  };
}

describe("consultSpellbook", () => {
  it("lifts when the spellbook is empty", () => {
    expect(consultSpellbook(disturbance("anything"), emptySpellbook)).toEqual({
      cast: false,
      reason: "no-match",
    });
  });

  it("casts the matching spell and returns its result", () => {
    const book: Spellbook = { spells: [spell("flag-typo", "typo")] };
    const result = consultSpellbook(disturbance("typo"), book);
    expect(result).toEqual({
      cast: true,
      spell: "flag-typo",
      result: { success: true, summary: "cast flag-typo" },
    });
  });

  it("falls through to the next matching spell if the first does not match", () => {
    const book: Spellbook = {
      spells: [spell("flag-typo", "typo"), spell("flag-dangling", "dangling-ref")],
    };
    expect(consultSpellbook(disturbance("dangling-ref"), book)).toEqual({
      cast: true,
      spell: "flag-dangling",
      result: { success: true, summary: "cast flag-dangling" },
    });
  });

  it("lifts when no spell matches", () => {
    const book: Spellbook = { spells: [spell("flag-typo", "typo")] };
    expect(consultSpellbook(disturbance("unknown"), book)).toEqual({
      cast: false,
      reason: "no-match",
    });
  });

  it("!failure-escalates: if a matching spell fails, lift rather than try another", () => {
    // The spec says a failed Spell means the world shifted in a way the
    // Spellbook didn't account for. Other Spells can't help.
    const book: Spellbook = {
      spells: [
        spell("flag-typo", "typo", /* succeeds */ false),
        spell("backup-flag-typo", "typo"),
      ],
    };
    expect(consultSpellbook(disturbance("typo"), book)).toEqual({
      cast: false,
      reason: "all-failed",
    });
  });

  it("first matcher that returns true wins — order is load-bearing for tie-break", () => {
    const book: Spellbook = {
      spells: [
        { ...spell("specific", "typo"), situation: "specific typo" },
        { ...spell("general", "typo"), situation: "any typo" },
      ],
    };
    const result = consultSpellbook(disturbance("typo"), book);
    expect(result).toEqual({
      cast: true,
      spell: "specific",
      result: { success: true, summary: "cast specific" },
    });
  });
});
