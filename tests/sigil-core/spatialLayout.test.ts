import { describe, expect, it } from "vitest";
import {
  arrangeSpatialIcons,
  type SpatialConnection,
  type SpatialLayoutIcon,
} from "sigil-core/spatialLayout";

const CANVAS = { width: 1200, height: 820 };

function arrange(icons: SpatialLayoutIcon[], connections: SpatialConnection[] = []) {
  return arrangeSpatialIcons(icons, connections, CANVAS.width, CANVAS.height);
}

describe("arrangeSpatialIcons", () => {
  it("gives every ring a stable region with doors on the left", () => {
    const positions = arrange([
      { name: "User", kind: "neighbor" },
      { name: "Idea", kind: "neighbor" },
      { name: "AttentionLanguage", kind: "god" },
      { name: "Elsewhere", kind: "landmark" },
      { name: "Language", kind: "narrative" },
      { name: "Memory", kind: "child" },
    ]);

    expect(positions.User.x).toBe(72);
    expect(positions.Idea.x).toBe(72);
    expect(positions.Idea.y).toBeGreaterThan(positions.User.y);
    expect(positions.AttentionLanguage.y).toBeLessThan(positions.Memory.y);
    expect(positions.Elsewhere.x).toBeGreaterThan(positions.Memory.x);
    expect(positions.Language.x).toBeLessThan(positions.Memory.x);
    expect(positions.Language.y).toBeGreaterThan(positions.Memory.y);
  });

  it("lays a sentence chain out as a readable horizontal narrative", () => {
    const icons = ["Path", "Recognition", "Consolidation", "Decay", "Relevance"]
      .map((name) => ({ name, kind: "child" as const }));
    const positions = arrange(icons, [
      { a: "Path", b: "Recognition" },
      { a: "Recognition", b: "Consolidation" },
      { a: "Consolidation", b: "Decay" },
      { a: "Decay", b: "Relevance" },
    ]);

    expect(positions.Path.x).toBeLessThan(positions.Recognition.x);
    expect(positions.Recognition.x).toBeLessThan(positions.Consolidation.x);
    expect(positions.Consolidation.x).toBeLessThan(positions.Decay.x);
    expect(positions.Decay.x).toBeLessThan(positions.Relevance.x);
    expect(new Set(icons.map(({ name }) => positions[name].y)).size).toBe(1);
  });

  it("places a secondary sentence path in a separate lane", () => {
    const icons = ["Spellbook", "BicameralMind", "Attention", "Love", "Body", "Awakening"]
      .map((name) => ({ name, kind: "child" as const }));
    const positions = arrange(icons, [
      { a: "BicameralMind", b: "Body" },
      { a: "BicameralMind", b: "Spellbook" },
      { a: "Attention", b: "BicameralMind" },
      { a: "Awakening", b: "Body" },
      { a: "Love", b: "Attention" },
    ]);

    expect(positions.Spellbook.x).toBeLessThan(positions.BicameralMind.x);
    expect(positions.BicameralMind.x).toBeLessThan(positions.Attention.x);
    expect(positions.Attention.x).toBeLessThan(positions.Love.x);
    expect(positions.Body.y).toBeLessThan(positions.BicameralMind.y);
    expect(positions.Awakening.y).toBe(positions.Body.y);
    expect(positions.Awakening.x).toBeGreaterThan(positions.Body.x);
  });

  it("uses a compact deterministic grid when prose does not connect children", () => {
    const icons = ["A", "B", "C", "D", "E", "F"]
      .map((name) => ({ name, kind: "child" as const }));
    const first = arrange(icons);
    const second = arrange(icons);
    const coordinates = icons.map(({ name }) => `${first[name].x}:${first[name].y}`);

    expect(first).toEqual(second);
    expect(new Set(coordinates).size).toBe(icons.length);
    for (const name of icons.map((icon) => icon.name)) {
      expect(first[name].x).toBeGreaterThanOrEqual(164);
      expect(first[name].x).toBeLessThanOrEqual(CANVAS.width - 112);
    }
  });
});
