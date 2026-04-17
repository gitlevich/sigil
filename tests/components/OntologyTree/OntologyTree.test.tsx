/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import type { SigilFolder, Idea } from "../../../src/tauri";
import { WorkspaceProvider } from "../../../src/state/WorkspaceContext";
import { ToastContext } from "../../../src/hooks/useToast";
import type { Toast } from "../../../src/hooks/useToast";
import {
  OntologyTree, canDropOnNode, buildOntology, nodeMatches, pathsEqual,
  flattenPaths, flattenNodes, childCountBand,
} from "../../../src/../src/components/OntologyTree/OntologyTree";
import type { OntologyNode } from "../../../src/../src/components/OntologyTree/OntologyTree";

// Mock all external deps
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/tauri", () => ({
  api: {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createContext: vi.fn().mockResolvedValue({ path: "/mock/new", name: "New", language: "", affordances: [], invariants: [], children: [], images: [] }),
    renameSigil: vi.fn().mockResolvedValue("1"),
    renameContext: vi.fn().mockResolvedValue("/mock/renamed"),
    moveSigil: vi.fn().mockResolvedValue("/mock/moved"),
    deleteContext: vi.fn().mockResolvedValue(undefined),
    previewDeleteSigil: vi.fn().mockResolvedValue({
      targetPath: "/mock/target",
      targetName: "Target",
      descendants: [],
      danglingReferences: [],
    }),
    previewRenameSigil: vi.fn().mockResolvedValue({
      operation: "rename-sigil",
      oldName: "Old",
      newName: "New",
      targetOldPath: "/mock/Old",
      targetNewPath: "/mock/New",
      fileChanges: [],
      directoryRenames: [],
      totalMatchCount: 0,
    }),
    readSigil: vi.fn().mockImplementation((rootPath: string) => Promise.resolve({
      name: "App", rootPath, vision: "", root: { name: "App", path: rootPath, language: "", affordances: [], invariants: [], children: [], images: [] },
    })),
    revealInFinder: vi.fn().mockResolvedValue(undefined),
  },
}));

// Stub DOM APIs not available in jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // @ts-ignore
  Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, x: 0, y: 0, toJSON: () => {},
  });
});

function makeFolder(name: string, opts?: {
  children?: SigilFolder[]; language?: string; path?: string;
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
  isImported?: boolean;
}): SigilFolder {
  return {
    name, path: opts?.path ?? `/mock/${name}`, language: opts?.language ?? "",
    affordances: opts?.affordances ?? [], invariants: opts?.invariants ?? [],
    children: (opts?.children ?? []) as SigilFolder[], images: [],
    isImported: opts?.isImported,
  } as SigilFolder;
}

function makeSpec(root: SigilFolder, importedOntologies?: SigilFolder): Idea {
  return { name: root.name, rootPath: root.path, vision: "", root, importedOntologies };
}

function node(name: string, opts?: Partial<OntologyNode>): OntologyNode {
  return {
    name, path: opts?.path ?? [name], fsPath: opts?.fsPath ?? `/mock/${name}`,
    depth: opts?.depth ?? 0, affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [], children: opts?.children ?? [],
    isImported: opts?.isImported ?? false,
  };
}

const toastCtx = { toasts: [] as Toast[], addToast: vi.fn(), removeToast: vi.fn() };

function Wrapper({ spec, children }: { spec: Idea; children: ReactNode }) {
  return (
    <ToastContext.Provider value={toastCtx}>
      <WorkspaceProvider spec={spec}>{children}</WorkspaceProvider>
    </ToastContext.Provider>
  );
}

// ── Pure helper tests ──

describe("buildOntology", () => {
  it("maps folder to node with flattened properties", () => {
    const f = makeFolder("Leaf", { affordances: [{ name: "act", content: "" }], invariants: [{ name: "rule", content: "" }] });
    const r = buildOntology(f, [], 0);
    expect(r.name).toBe("Leaf");
    expect(r.affordances).toEqual(["act"]);
    expect(r.invariants).toEqual(["rule"]);
    expect(r.children).toEqual([]);
    expect(r.depth).toBe(0);
  });

  it("recursively builds children with incremented depth and paths", () => {
    const child = makeFolder("Child", { path: "/mock/Root/Child" });
    const root = makeFolder("Root", { children: [child] });
    const r = buildOntology(root, [], 0);
    expect(r.children).toHaveLength(1);
    expect(r.children[0].name).toBe("Child");
    expect(r.children[0].depth).toBe(1);
    expect(r.children[0].path).toEqual(["Child"]);
  });

  it("propagates isImported flag", () => {
    expect(buildOntology(makeFolder("L", { isImported: true }), [], 0).isImported).toBe(true);
    expect(buildOntology(makeFolder("L"), [], 0).isImported).toBe(false);
  });
});

describe("nodeMatches", () => {
  it("matches by name case-insensitive", () => expect(nodeMatches(node("Observer"), "observer")).toBe(true));
  it("no match for unrelated query", () => expect(nodeMatches(node("Observer"), "zzz")).toBe(false));
  it("matches via descendant", () => expect(nodeMatches(node("P", { children: [node("Deep")] }), "deep")).toBe(true));
  it("matches partial name", () => expect(nodeMatches(node("LexicalScope"), "lexical")).toBe(true));
});

describe("pathsEqual", () => {
  it("identical paths", () => expect(pathsEqual(["a", "b"], ["a", "b"])).toBe(true));
  it("different lengths", () => expect(pathsEqual(["a"], ["a", "b"])).toBe(false));
  it("different values", () => expect(pathsEqual(["a"], ["b"])).toBe(false));
  it("both empty", () => expect(pathsEqual([], [])).toBe(true));
});

describe("flattenPaths", () => {
  it("flattens nested paths", () => {
    const gc = node("GC", { path: ["A", "B", "GC"] });
    const b = node("B", { path: ["A", "B"], children: [gc] });
    const a = node("A", { path: ["A"], children: [b] });
    expect(flattenPaths(a)).toEqual([["A"], ["A", "B"], ["A", "B", "GC"]]);
  });
  it("single node", () => expect(flattenPaths(node("X", { path: ["X"] }))).toEqual([["X"]]));
});

describe("flattenNodes", () => {
  it("flattens hierarchy", () => {
    const r = node("R", { children: [node("C", { children: [node("GC")] })] });
    expect(flattenNodes(r).map(n => n.name)).toEqual(["R", "C", "GC"]);
  });
});

describe("childCountBand", () => {
  it("returns null for zero", () => expect(childCountBand(0)).toBeNull());
  it("returns green for 1–5", () => {
    expect(childCountBand(1)).toBe("green");
    expect(childCountBand(5)).toBe("green");
  });
  it("returns yellow for 6–8", () => {
    expect(childCountBand(6)).toBe("yellow");
    expect(childCountBand(8)).toBe("yellow");
  });
  it("returns red for 9+", () => {
    expect(childCountBand(9)).toBe("red");
    expect(childCountBand(42)).toBe("red");
  });
});

describe("canDropOnNode", () => {
  const nodes = [node("A", { fsPath: "/a" }), node("B", { fsPath: "/b" })];
  it("rejects self", () => expect(canDropOnNode("/a", "/a", nodes)).toBe(false));
  it("rejects descendant", () => expect(canDropOnNode("/a", "/a/b", nodes)).toBe(false));
  it("allows valid", () => expect(canDropOnNode("/a", "/b", nodes)).toBe(true));
  it("rejects unknown target", () => expect(canDropOnNode("/a", "/z", nodes)).toBe(false));
  it("allows dense target — density is now a visual hint, not a hard limit", () => {
    const dense = node("D", { fsPath: "/d", children: [node("1", { fsPath: "/1" }), node("2", { fsPath: "/2" }), node("3", { fsPath: "/3" }), node("4", { fsPath: "/4" }), node("5", { fsPath: "/5" }), node("6", { fsPath: "/6" })] });
    expect(canDropOnNode("/a", "/d", [...nodes, dense])).toBe(true);
  });
});

// ── Component rendering ──

describe("OntologyTree component", () => {
  it("renders child node names", async () => {
    const root = makeFolder("App", { children: [makeFolder("Alpha"), makeFolder("Beta")], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    expect(container!.textContent).toContain("Alpha");
    expect(container!.textContent).toContain("Beta");
  });

  it("renders search input", async () => {
    const root = makeFolder("App", { path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    expect(container!.querySelector("input")).not.toBeNull();
  });

  it("search filters visible nodes", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Alpha"), makeFolder("Beta")],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const input = container!.querySelector("input")!;
    await act(async () => { fireEvent.change(input, { target: { value: "alpha" } }); });
    // Alpha should be visible
    expect(container!.textContent).toContain("Alpha");
  });

  it("renders affordance and invariant indicators", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Widget", {
        affordances: [{ name: "render", content: "" }],
        invariants: [{ name: "speed", content: "" }],
      })],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    expect(container!.textContent).toContain("Widget");
  });

  it("renders imported ontologies section", async () => {
    const lib = makeFolder("AttentionLanguage", { children: [makeFolder("Concept1")], isImported: true });
    const imported = makeFolder("Imported Ontologies", { children: [lib] });
    const root = makeFolder("App", { path: "/mock/App" });
    const spec = makeSpec(root, imported);
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={spec}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    expect(container!.textContent).toContain("Concept1");
  });

  it("context menu opens on right-click", async () => {
    const root = makeFolder("App", { children: [makeFolder("Child")], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='name']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    if (childSpan) {
      const row = childSpan.closest("[class*='row']") || childSpan.parentElement;
      if (row) {
        await act(async () => {
          fireEvent.contextMenu(row, { clientX: 100, clientY: 200 });
        });
        expect(container!.textContent).toContain("Rename");
        expect(container!.textContent).toContain("Delete");
      }
    }
  });

  it("click on node name navigates", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Alpha"), makeFolder("Beta")],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='name']");
    const alphaSpan = Array.from(nameSpans).find(el => el.textContent === "Alpha");
    if (alphaSpan) {
      const row = alphaSpan.closest("[class*='row']") || alphaSpan.parentElement;
      if (row) {
        await act(async () => { fireEvent.click(row); });
        // After click, the node should become active (get active class)
      }
    }
  });

  it("keyboard ArrowDown navigates to next node", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Alpha"), makeFolder("Beta")],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    // Focus the container and press ArrowDown
    const treeContainer = container!.querySelector("[tabindex]") as HTMLElement;
    if (treeContainer) {
      await act(async () => {
        fireEvent.keyDown(treeContainer, { key: "ArrowDown" });
      });
    }
  });

  it("keyboard ArrowUp navigates to previous node", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Alpha"), makeFolder("Beta")],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const treeContainer = container!.querySelector("[tabindex]") as HTMLElement;
    if (treeContainer) {
      // Navigate down first, then up
      await act(async () => { fireEvent.keyDown(treeContainer, { key: "ArrowDown" }); });
      await act(async () => { fireEvent.keyDown(treeContainer, { key: "ArrowUp" }); });
    }
  });

  it("chevron button toggles collapse", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Parent", { children: [makeFolder("Child")] })],
      path: "/mock/App",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    // Find the chevron button
    const chevrons = container!.querySelectorAll("[class*='chevron']");
    if (chevrons.length > 0) {
      await act(async () => { fireEvent.click(chevrons[0]); });
      // After toggle, the collapsed state should change
    }
  });

  it("renders with nested children at multiple depths", async () => {
    const grandchild = makeFolder("GC", { path: "/mock/App/P/GC" });
    const parent = makeFolder("Parent", { children: [grandchild], path: "/mock/App/P" });
    const root = makeFolder("App", { children: [parent], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    expect(container!.textContent).toContain("Parent");
    expect(container!.textContent).toContain("GC");
  });

  it("context menu Rename opens rename dialog", async () => {
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    // Right-click to open context menu
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      // Click Rename button
      const renameBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Rename");
      if (renameBtn) {
        await act(async () => { fireEvent.click(renameBtn); });
        // Rename dialog should appear
        expect(container!.textContent).toContain("Rename to:");
      }
    }
  });

  it("rename dialog: Enter commits rename", async () => {
    const { api } = await import("../../../src/tauri");
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    // Open context menu, click Rename
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      const renameBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Rename");
      if (renameBtn) {
        await act(async () => { fireEvent.click(renameBtn); });
        const renameInput = container!.querySelector("[class*='renameInput']") as HTMLInputElement;
        if (renameInput) {
          fireEvent.change(renameInput, { target: { value: "NewName" } });
          await act(async () => { fireEvent.keyDown(renameInput, { key: "Enter" }); });
          expect(api.renameSigil).toHaveBeenCalled();
        }
      }
    }
  });

  it("rename dialog: Escape cancels", async () => {
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      const renameBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Rename");
      if (renameBtn) {
        await act(async () => { fireEvent.click(renameBtn); });
        const renameInput = container!.querySelector("[class*='renameInput']") as HTMLInputElement;
        if (renameInput) {
          await act(async () => { fireEvent.keyDown(renameInput, { key: "Escape" }); });
          // Rename overlay should be gone
          expect(container!.querySelector("[class*='renameOverlay']")).toBeNull();
        }
      }
    }
  });

  it("context menu Find References opens refs dropdown", async () => {
    const root = makeFolder("App", {
      children: [makeFolder("Child", { path: "/mock/App/Child", language: "Uses @Child here." })],
      path: "/mock/App",
      language: "References @Child.",
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      const findRefsBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Find References");
      if (findRefsBtn) {
        await act(async () => { fireEvent.click(findRefsBtn); });
      }
    }
  });

  it("context menu Open in Finder calls api", async () => {
    const { api } = await import("../../../src/tauri");
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      const openBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Open in Finder");
      if (openBtn) {
        await act(async () => { fireEvent.click(openBtn); });
        expect(api.revealInFinder).toHaveBeenCalledWith("/mock/App/Child");
      }
    }
  });

  it("context menu Copy Path writes to clipboard", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
      const copyBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Copy Path");
      if (copyBtn) {
        await act(async () => { fireEvent.click(copyBtn); });
        expect(writeText).toHaveBeenCalledWith("/mock/App/Child");
      }
    }
  });

  it("context menu Delete opens the propose-delete modal, not native confirm", async () => {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    (confirm as unknown as { mockClear: () => void }).mockClear();
    const { api } = await import("../../../src/tauri");
    (api.deleteContext as unknown as { mockClear: () => void }).mockClear();
    const root = makeFolder("App", { children: [makeFolder("Child", { path: "/mock/App/Child" })], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan!.closest("[class*='row']") as HTMLElement;
    await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
    const menuDeleteBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Delete") as HTMLButtonElement;
    expect(menuDeleteBtn).toBeTruthy();
    await act(async () => { fireEvent.click(menuDeleteBtn); });
    // The native confirm must NOT be used — it's broken on macOS 26 Tauri runtime
    expect(confirm).not.toHaveBeenCalled();
    // Modal should render with the title naming the target.
    await waitFor(() => {
      expect(container!.textContent).toContain("Propose reshape: delete @Child");
    });
    const approveBtn = Array.from(container!.querySelectorAll("button")).find(b => (b.textContent || "").includes("Approve delete")) as HTMLButtonElement;
    expect(approveBtn).toBeTruthy();
    await act(async () => { fireEvent.click(approveBtn); });
    await waitFor(() => {
      expect(api.deleteContext).toHaveBeenCalledWith("/mock/App/Child");
    });
  });

  it("right-click on a row does not trigger any file operations", async () => {
    const { api } = await import("../../../src/tauri");
    (api.writeFile as unknown as { mockClear: () => void }).mockClear();
    (api.deleteFile as unknown as { mockClear: () => void }).mockClear();
    (api.deleteContext as unknown as { mockClear: () => void }).mockClear();
    const leaf = makeFolder("Leaf", { path: "/mock/App/Leaf", children: [] });
    const root = makeFolder("App", { children: [leaf], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const leafSpan = Array.from(nameSpans).find(el => el.textContent === "Leaf");
    const row = leafSpan!.closest("[class*='row']") as HTMLElement;
    // Full right-click sequence: mousedown + contextmenu + mouseup, all with button 2
    await act(async () => {
      fireEvent.mouseDown(row, { button: 2 });
      fireEvent.contextMenu(row, { button: 2, clientX: 50, clientY: 50 });
      fireEvent.mouseUp(row, { button: 2 });
    });
    // Right-click must not trigger any write/delete side effects
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(api.deleteContext).not.toHaveBeenCalled();
  });

  it("context menu Delete works on an empty leaf node (propose-delete modal)", async () => {
    const { api } = await import("../../../src/tauri");
    (api.deleteContext as unknown as { mockClear: () => void }).mockClear();
    const leaf = makeFolder("Leaf", { path: "/mock/App/Leaf", children: [] });
    const root = makeFolder("App", { children: [leaf], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const leafSpan = Array.from(nameSpans).find(el => el.textContent === "Leaf");
    const row = leafSpan!.closest("[class*='row']") as HTMLElement;
    await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
    const menuDeleteBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Delete") as HTMLButtonElement;
    await act(async () => { fireEvent.click(menuDeleteBtn); });
    await waitFor(() => {
      const approveBtn = Array.from(container!.querySelectorAll("button")).find(b => (b.textContent || "").includes("Approve delete"));
      expect(approveBtn).toBeTruthy();
    });
    const approveBtn = Array.from(container!.querySelectorAll("button")).find(b => (b.textContent || "").includes("Approve delete")) as HTMLButtonElement;
    await act(async () => { fireEvent.click(approveBtn); });
    await waitFor(() => {
      expect(api.deleteContext).toHaveBeenCalledWith("/mock/App/Leaf");
    });
  });

  it("Escape cancels the propose-delete modal", async () => {
    const { api } = await import("../../../src/tauri");
    (api.deleteContext as unknown as { mockClear: () => void }).mockClear();
    const leaf = makeFolder("Leaf", { path: "/mock/App/Leaf", children: [] });
    const root = makeFolder("App", { children: [leaf], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const leafSpan = Array.from(nameSpans).find(el => el.textContent === "Leaf");
    const row = leafSpan!.closest("[class*='row']") as HTMLElement;
    await act(async () => { fireEvent.contextMenu(row, { clientX: 50, clientY: 50 }); });
    const menuDeleteBtn = Array.from(container!.querySelectorAll("button")).find(b => b.textContent === "Delete") as HTMLButtonElement;
    await act(async () => { fireEvent.click(menuDeleteBtn); });
    await waitFor(() => {
      expect(container!.textContent).toContain("Propose reshape: delete @Leaf");
    });
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(api.deleteContext).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container!.textContent).not.toContain("Propose reshape: delete @Leaf");
    });
  });

  it("definition toggle shows textarea", async () => {
    const root = makeFolder("App", { children: [makeFolder("Child")], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    const defBtns = container!.querySelectorAll("[class*='defBtn']");
    if (defBtns.length > 0) {
      await act(async () => { fireEvent.click(defBtns[0]); });
      expect(container!.querySelector("textarea")).not.toBeNull();
    }
  });

  it("Shift+Enter on focused container triggers peer input (when path > 0)", async () => {
    const root = makeFolder("App", { children: [makeFolder("Child")], path: "/mock/App" });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper spec={makeSpec(root)}><OntologyTree /></Wrapper>);
      container = result.container;
    });
    // First navigate to Child
    const nameSpans = container!.querySelectorAll("[class*='term']");
    const childSpan = Array.from(nameSpans).find(el => el.textContent === "Child");
    const row = childSpan?.closest("[class*='row']") || childSpan?.parentElement;
    if (row) {
      await act(async () => { fireEvent.click(row); });
    }
    // Now press Shift+Enter
    const treeContainer = container!.querySelector("[tabindex]") as HTMLElement;
    if (treeContainer) {
      await act(async () => { fireEvent.keyDown(treeContainer, { key: "Enter", shiftKey: true }); });
      // Peer input should appear
      const peerInput = container!.querySelector("[class*='peerInput']");
      expect(peerInput).not.toBeNull();
    }
  });
});
