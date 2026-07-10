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
    expect(positions.Relevance.x - positions.Path.x).toBeGreaterThan(CANVAS.width / 2);
  });

  it("groups doors left, children in the middle, and referenced sigils right", () => {
    const neighbors = ["LeftHemisphere", "RightHemisphere", "CorpusCallosum", "Memory"];
    const landmarks = ["Subconscious", "Spellbook", "Experience", "Relevance", "Gate", "Narration", "Spell", "Recognition"];
    const icons: SpatialLayoutIcon[] = [
      ...neighbors.map((name) => ({ name, kind: "neighbor" as const })),
      { name: "ChildA", kind: "child" },
      { name: "ChildB", kind: "child" },
      ...landmarks.map((name) => ({ name, kind: "landmark" as const })),
    ];
    const positions = arrange(icons, [{ a: "ChildA", b: "ChildB" }]);

    for (const door of neighbors) expect(positions[door].x).toBe(72);
    expect(positions.ChildA.x).toBeGreaterThan(positions.LeftHemisphere.x);
    expect(positions.ChildB.x).toBeGreaterThan(positions.ChildA.x);
    for (const landmark of landmarks) expect(positions[landmark].x).toBeGreaterThan(positions.ChildB.x);

    const landmarkXs = new Set(landmarks.map((name) => positions[name].x));
    const landmarkYs = new Set(landmarks.map((name) => positions[name].y));
    expect(landmarkXs.size).toBe(2);
    expect(landmarkYs.size).toBe(4);
    expect(new Set(landmarks.map((name) => `${positions[name].x}:${positions[name].y}`)).size)
      .toBe(landmarks.length);
  });

  it("keeps a lone landmark on the upper horizon when children inhabit the field", () => {
    const positions = arrange([
      { name: "Elsewhere", kind: "landmark" },
      { name: "A", kind: "child" },
      { name: "B", kind: "child" },
    ], [{ a: "A", b: "B" }]);

    expect(positions.Elsewhere.x).toBe(CANVAS.width - 96);
    expect(positions.Elsewhere.y).toBeLessThan(positions.A.y);
    expect(positions.A.y).toBe(positions.B.y);
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
