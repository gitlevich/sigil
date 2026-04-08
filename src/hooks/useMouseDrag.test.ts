import { describe, it, expect } from "vitest";
import { canDropOnNode } from "../components/OntologyTree/OntologyTree";

// canDropOnNode is the extracted pure logic from the drag-drop system.
// useMouseDrag itself is a React hook with DOM event listeners —
// its timing fix (setTimeout vs queueMicrotask) requires integration testing.

interface TestNode {
  name: string;
  path: string[];
  fsPath: string;
  depth: number;
  affordances: string[];
  invariants: string[];
  children: TestNode[];
  isImported: boolean;
}

function node(name: string, fsPath: string, opts?: { children?: TestNode[]; isImported?: boolean }): TestNode {
  return {
    name,
    path: [name],
    fsPath,
    depth: 0,
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
    isImported: opts?.isImported ?? false,
  };
}

describe("canDropOnNode", () => {
  const child1 = node("A", "/root/A");
  const child2 = node("B", "/root/B");
  const child3 = node("C", "/root/C");
  const root = node("Root", "/root", { children: [child1, child2, child3] });
  const allNodes = [root, child1, child2, child3];

  it("rejects self-drop", () => {
    expect(canDropOnNode("/root/A", "/root/A", allNodes)).toBe(false);
  });

  it("rejects drop onto descendant", () => {
    expect(canDropOnNode("/root", "/root/A", allNodes)).toBe(false);
  });

  it("accepts valid sibling drop", () => {
    expect(canDropOnNode("/root/A", "/root/B", allNodes)).toBe(true);
  });

  it("accepts drop onto parent", () => {
    expect(canDropOnNode("/root/A", "/root", allNodes)).toBe(true);
  });

  it("rejects drop onto unknown target", () => {
    expect(canDropOnNode("/root/A", "/nonexistent", allNodes)).toBe(false);
  });

  it("rejects drop onto node with 5+ children", () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      node(`K${i}`, `/root/Full/K${i}`)
    );
    const fullNode = node("Full", "/root/Full", { children: kids });
    const nodes = [root, fullNode, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Full", nodes)).toBe(false);
  });

  it("allows drop onto imported node with 5+ children", () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      node(`K${i}`, `/root/Lib/K${i}`)
    );
    const importedNode = node("Lib", "/root/Lib", { children: kids, isImported: true });
    const nodes = [root, importedNode, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Lib", nodes)).toBe(true);
  });

  it("allows drop onto node with exactly 4 children", () => {
    const kids = Array.from({ length: 4 }, (_, i) =>
      node(`K${i}`, `/root/Almost/K${i}`)
    );
    const almostFull = node("Almost", "/root/Almost", { children: kids });
    const nodes = [root, almostFull, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Almost", nodes)).toBe(true);
  });
});
