import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { canDropOnNode } from "../../src/components/OntologyTree/OntologyTree";
import { createDragGhost } from "../../src/../src/hooks/useMouseDrag";

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

  it("allows drop onto dense node — density is a visual hint, not a hard limit", () => {
    const kids = Array.from({ length: 9 }, (_, i) =>
      node(`K${i}`, `/root/Dense/K${i}`)
    );
    const denseNode = node("Dense", "/root/Dense", { children: kids });
    const nodes = [root, denseNode, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Dense", nodes)).toBe(true);
  });

  it("allows drop onto imported node with many children", () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      node(`K${i}`, `/root/Lib/K${i}`)
    );
    const importedNode = node("Lib", "/root/Lib", { children: kids, isImported: true });
    const nodes = [root, importedNode, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Lib", nodes)).toBe(true);
  });

  it("allows drop onto sparse node", () => {
    const kids = Array.from({ length: 4 }, (_, i) =>
      node(`K${i}`, `/root/Sparse/K${i}`)
    );
    const sparseNode = node("Sparse", "/root/Sparse", { children: kids });
    const nodes = [root, sparseNode, ...kids, child1];
    expect(canDropOnNode("/root/A", "/root/Sparse", nodes)).toBe(true);
  });
});

describe("createDragGhost", () => {
  let ghost: ReturnType<typeof createDragGhost>;
  let mockClone: Record<string, unknown>;
  let appendSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;

  function mockSourceEl(rect: { left: number; top: number; width: number; height: number }) {
    removeSpy = vi.fn();
    mockClone = { style: {} as Record<string, string>, remove: removeSpy };
    return {
      getBoundingClientRect: () => rect,
      cloneNode: vi.fn(() => mockClone),
    } as unknown as HTMLElement;
  }

  beforeEach(() => {
    appendSpy = vi.fn();
    vi.stubGlobal("document", {
      body: { appendChild: appendSpy },
    });
    ghost = createDragGhost();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clones source element and appends to body", () => {
    const source = mockSourceEl({ left: 10, top: 20, width: 200, height: 30 });
    ghost.show(source, 50, 35);
    expect(source.cloneNode).toHaveBeenCalledWith(true);
    expect(appendSpy).toHaveBeenCalledWith(mockClone);
  });

  it("positions ghost at source element's original position", () => {
    const source = mockSourceEl({ left: 10, top: 20, width: 200, height: 30 });
    ghost.show(source, 50, 35);
    const style = mockClone.style as Record<string, string>;
    expect(style.left).toBe("10px");
    expect(style.top).toBe("20px");
    expect(style.width).toBe("200px");
  });

  it("makes ghost non-interactive and semi-transparent", () => {
    const source = mockSourceEl({ left: 0, top: 0, width: 100, height: 30 });
    ghost.show(source, 0, 0);
    const style = mockClone.style as Record<string, string>;
    expect(style.pointerEvents).toBe("none");
    expect(style.opacity).toBe("0.7");
    expect(style.position).toBe("fixed");
  });

  it("moves ghost preserving grab offset", () => {
    // Grab at (50, 35), element starts at (10, 20) → offset is (40, 15)
    const source = mockSourceEl({ left: 10, top: 20, width: 200, height: 30 });
    ghost.show(source, 50, 35);
    // Move cursor to (100, 80) → ghost should be at (60, 65)
    ghost.move(100, 80);
    const style = mockClone.style as Record<string, string>;
    expect(style.left).toBe("60px");
    expect(style.top).toBe("65px");
  });

  it("removes ghost element on hide", () => {
    const source = mockSourceEl({ left: 0, top: 0, width: 100, height: 30 });
    ghost.show(source, 0, 0);
    ghost.hide();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("hide and move are safe without prior show", () => {
    expect(() => ghost.hide()).not.toThrow();
    expect(() => ghost.move(10, 10)).not.toThrow();
  });
});
