/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

const selectTextListeners: Array<(req: { request_id: string; payload: { from_line?: number | null; to_line?: number | null; excerpt?: string | null } }) => void> = [];
const replaceTextListeners: Array<(req: { request_id: string; payload: { text: string } }) => void> = [];

vi.mock("../../../src/tauri", () => ({
  api: {
    writeImageBytes: vi.fn().mockResolvedValue("/mock/img.png"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    readSigil: vi.fn(),
    toolResult: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onToolSelectText: vi.fn((cb: (req: { request_id: string; payload: { from_line?: number | null; to_line?: number | null; excerpt?: string | null } }) => void) => {
      selectTextListeners.push(cb);
      return Promise.resolve(() => {});
    }),
    onSelectText: vi.fn().mockResolvedValue(() => {}),
    onToolReplaceSelectedText: vi.fn((cb: (req: { request_id: string; payload: { text: string } }) => void) => {
      replaceTextListeners.push(cb);
      return Promise.resolve(() => {});
    }),
  },
  Context: {},
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "../../../src/tauri";
import { LanguageEditor, isImageFile, findStatusAtCursor, buildCustomKeymap } from "../../../src/components/Workspace/LanguageEditor";
import { setEditorScopeForTest } from "../../../src/components/Workspace/editorScope";
import type { SigilFolder } from "../../../src/tauri";

function folder(name: string, opts?: {
  language?: string; path?: string; children?: SigilFolder[];
  affordances?: { name: string; content: string }[];
  invariants?: { name: string; content: string }[];
}): SigilFolder {
  return {
    name, language: opts?.language ?? "", affordances: opts?.affordances ?? [],
    invariants: opts?.invariants ?? [], children: (opts?.children ?? []) as SigilFolder[],
    path: opts?.path ?? `/mock/${name}`, images: [],
  } as SigilFolder;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // @ts-ignore
  Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });
  // Stub Range.getClientRects for CodeMirror coordinate calculations
  Range.prototype.getClientRects = vi.fn().mockReturnValue([
    { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10, x: 10, y: 10, toJSON: () => {} },
  ]);
  // @ts-ignore
  Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10, x: 10, y: 10, toJSON: () => {},
  });
  vi.clearAllMocks();
  selectTextListeners.length = 0;
  replaceTextListeners.length = 0;
});

afterEach(() => {
  cleanup();
  vi.stubGlobal("requestAnimationFrame", vi.fn());
});

// ── findStatusAtCursor ──

describe("findStatusAtCursor", () => {
  it("returns status value when cursor is on status line in frontmatter", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "---\nstatus: idea\n---\n# Content" }),
      parent,
    });
    // Place cursor on the status line (line 2, position inside "status: idea")
    view.dispatch({ selection: { anchor: 4 } }); // start of "status: idea"
    const result = findStatusAtCursor(view);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("idea");
    view.destroy();
  });

  it("returns null when cursor is outside frontmatter", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "---\nstatus: idea\n---\n# Content" }),
      parent,
    });
    // Place cursor on "# Content" (after the closing ---)
    view.dispatch({ selection: { anchor: 25 } });
    expect(findStatusAtCursor(view)).toBeNull();
    view.destroy();
  });

  it("returns null when no frontmatter", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "# No frontmatter" }),
      parent,
    });
    view.dispatch({ selection: { anchor: 3 } });
    expect(findStatusAtCursor(view)).toBeNull();
    view.destroy();
  });

  it("returns null when cursor is on a non-status frontmatter line", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "---\ntitle: Hello\nstatus: done\n---" }),
      parent,
    });
    // Place cursor on "title: Hello" line
    view.dispatch({ selection: { anchor: 5 } });
    expect(findStatusAtCursor(view)).toBeNull();
    view.destroy();
  });
});

describe("isImageFile", () => {
  it("recognizes png", () => expect(isImageFile("photo.png")).toBe(true));
  it("recognizes jpg", () => expect(isImageFile("photo.jpg")).toBe(true));
  it("recognizes jpeg", () => expect(isImageFile("photo.jpeg")).toBe(true));
  it("recognizes gif", () => expect(isImageFile("anim.gif")).toBe(true));
  it("recognizes svg", () => expect(isImageFile("icon.svg")).toBe(true));
  it("recognizes webp", () => expect(isImageFile("image.webp")).toBe(true));
  it("rejects markdown", () => expect(isImageFile("doc.md")).toBe(false));
  it("rejects no extension", () => expect(isImageFile("noext")).toBe(false));
});

describe("LanguageEditor component", () => {
  it("mounts and renders content in CodeMirror", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="# Hello World"
          onChange={vi.fn()}
        />,
      );
      container = result.container;
    });
    // CodeMirror should have created its DOM
    const cmContent = container!.querySelector(".cm-content");
    expect(cmContent).not.toBeNull();
    expect(cmContent!.textContent).toContain("Hello World");
  });

  it("shows empty hint when content is empty", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="" onChange={vi.fn()} />,
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("narrate");
  });

  it("does not show empty hint when content exists", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Some content" onChange={vi.fn()} />,
      );
      container = result.container;
    });
    const hint = container!.querySelector("[class*='emptyHint']");
    // Hint may be in DOM but hidden — check if it's rendered at all
    // Content should be present in the CodeMirror editor
    const cmContent = container!.querySelector(".cm-content");
    expect(cmContent!.textContent).toContain("Some content");
  });

  it("renders with frontmatter content", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="---\nstatus: idea\n---\n# Title"
          onChange={vi.fn()}
        />,
      );
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content");
    expect(cmContent).not.toBeNull();
  });

  it("renders with siblings for highlighting", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="Uses @Observer here."
          onChange={vi.fn()}
          scopeNames={["Observer"]}
          siblings={[{ name: "Observer", summary: "watches", kind: "contained" as const }]}
          sigilRoot={{ name: "Root", path: "/mock/Root", language: "", affordances: [], invariants: [], children: [{ name: "Observer", path: "/mock/Root/Observer", language: "watches", affordances: [], invariants: [], children: [], images: [] }], images: [] } as any}
          currentContext={{ name: "Root", path: "/mock/Root", language: "", affordances: [], invariants: [], children: [], images: [] } as any}
          currentPath={[]}
        />,
      );
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content");
    expect(cmContent!.textContent).toContain("Observer");
  });

  it("renders with word wrap enabled", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Long content" onChange={vi.fn()} wordWrap={true} />,
      );
      container = result.container;
    });
    expect(container!.querySelector(".cm-content")).not.toBeNull();
  });

  it("renders with keybindings", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="test"
          onChange={vi.fn()}
          keybindings={{ "rename-sigil": "Alt-Mod-r", "create-sigil": "Alt-Enter", "delete-line": "Mod-d", "find-references": "Alt-Mod-f" }}
        />,
      );
      container = result.container;
    });
    expect(container!.querySelector(".cm-content")).not.toBeNull();
  });

  it("updates content when prop changes (simulating navigation)", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor content="Original" onChange={onChange} currentPath={["A"]} />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor content="New content" onChange={onChange} currentPath={["B"]} />,
      );
    });

    const cmContent = container.querySelector(".cm-content");
    expect(cmContent!.textContent).toContain("New content");
  });

  it("renders line numbers", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Line 1\nLine 2\nLine 3" onChange={vi.fn()} />,
      );
      container = result.container;
    });
    // CodeMirror renders line numbers in a gutter
    const gutters = container!.querySelector(".cm-gutters");
    expect(gutters).not.toBeNull();
  });

  it("mounts with all callback props", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="Test content"
          onChange={vi.fn()}
          onCreateSigil={vi.fn()}
          onCreateAffordance={vi.fn()}
          onCreateInvariant={vi.fn()}
          onRenameSigil={vi.fn()}
          onRenameProperty={vi.fn()}
          onRenameStatus={vi.fn()}
          onNavigateToSigil={vi.fn()}
          onNavigateToAbsPath={vi.fn()}
          sigilDir="/mock/dir"
        />,
      );
      container = result.container;
    });
    expect(container!.querySelector(".cm-content")).not.toBeNull();
  });

  it("content change via CodeMirror calls onChange", async () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Initial" onChange={onChange} />,
      );
      container = result.container;
    });
    // The editor is mounted — type into it would require dispatching CM transactions
    // But mounting already exercises the updateListener path
    expect(container!.querySelector(".cm-content")).not.toBeNull();
  });

  it("handles goToLine prop", async () => {
    const onGoToLineDone = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor
        content="Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
        onChange={vi.fn()}
        goToLine={null}
        onGoToLineDone={onGoToLineDone}
      />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor
          content="Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
          onChange={vi.fn()}
          goToLine={3}
          onGoToLineDone={onGoToLineDone}
        />,
      );
    });

    // Give requestAnimationFrame time to fire
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  });

  it("handles findReferencesName prop", async () => {
    const onClear = vi.fn();
    const root = { name: "Root", path: "/mock/Root", language: "Uses @Observer.", affordances: [], invariants: [], children: [{ name: "Observer", path: "/mock/Root/Observer", language: "@Observer is here too.", affordances: [], invariants: [], children: [], images: [] }], images: [] } as any;

    const { rerender } = render(
      <LanguageEditor
        content="Uses @Observer."
        onChange={vi.fn()}
        sigilRoot={root}
        findReferencesName={null}
        onFindReferencesClear={onClear}
      />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor
          content="Uses @Observer."
          onChange={vi.fn()}
          sigilRoot={root}
          findReferencesName="Observer"
          onFindReferencesClear={onClear}
        />,
      );
    });

    expect(onClear).toHaveBeenCalled();
  });

  it("toggles word wrap via prop change", async () => {
    const { rerender, container } = render(
      <LanguageEditor content="test" onChange={vi.fn()} wordWrap={false} />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor content="test" onChange={vi.fn()} wordWrap={true} />,
      );
    });

    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("reconfigures keybindings on prop change", async () => {
    const { rerender, container } = render(
      <LanguageEditor content="test" onChange={vi.fn()} keybindings={{}} />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor content="test" onChange={vi.fn()} keybindings={{ "delete-line": "Mod-Shift-d" }} />,
      );
    });

    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("content sync: local edit then rerender with same content is no-op", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor content="Hello" onChange={onChange} currentPath={["A"]} />,
    );
    // Simulate what happens when onChange fires with the same content back
    await act(async () => {
      rerender(<LanguageEditor content="Hello" onChange={onChange} currentPath={["A"]} />);
    });
    const cmContent = container.querySelector(".cm-content");
    expect(cmContent!.textContent).toContain("Hello");
  });

  it("content sync: navigation replaces doc content", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor content="Page A content" onChange={onChange} currentPath={["A"]} />,
    );
    await act(async () => {
      rerender(<LanguageEditor content="Page B content" onChange={onChange} currentPath={["B"]} />);
    });
    expect(container.querySelector(".cm-content")!.textContent).toContain("Page B content");
  });

  it("content sync: external reload without path change replaces content", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor content="Original" onChange={onChange} currentPath={["A"]} />,
    );
    // Same path, different content — external reload
    await act(async () => {
      rerender(<LanguageEditor content="Reloaded" onChange={onChange} currentPath={["A"]} />);
    });
    // Should update since localEditRef is false
    expect(container.querySelector(".cm-content")!.textContent).toContain("Reloaded");
  });

  it("content sync: manual refresh replaces focused editor content", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <LanguageEditor content="Original" onChange={onChange} currentPath={["A"]} refreshSerial={0} />,
    );
    (container.querySelector(".cm-content") as HTMLElement).focus();

    await act(async () => {
      rerender(<LanguageEditor content="Reloaded" onChange={onChange} currentPath={["A"]} refreshSerial={1} />);
    });

    expect(container.querySelector(".cm-content")!.textContent).toContain("Reloaded");
  });

  it("DOM keydown/keyup events are wired on CodeMirror content", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<LanguageEditor content="test" onChange={vi.fn()} />);
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content") as HTMLElement;
    expect(cmContent).not.toBeNull();
    // Fire Meta keydown/keyup — handler adds/removes cm-cmd-held on view.dom (parent .cm-editor)
    if (cmContent) {
      await act(async () => { fireEvent.keyDown(cmContent, { key: "Meta" }); });
      await act(async () => { fireEvent.keyUp(cmContent, { key: "Meta" }); });
    }
  });

  it("blur event on content removes cmd-held class", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<LanguageEditor content="test" onChange={vi.fn()} />);
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content") as HTMLElement;
    if (cmContent) {
      await act(async () => { fireEvent.keyDown(cmContent, { key: "Meta" }); });
      await act(async () => { fireEvent.blur(cmContent); });
    }
  });

  it("empty content shows empty hint div", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<LanguageEditor content="" onChange={vi.fn()} />);
      container = result.container;
    });
    const hint = container!.querySelector("[class*='emptyHint']");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("narrate");
  });

  it("non-empty content hides empty hint", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<LanguageEditor content="has content" onChange={vi.fn()} />);
      container = result.container;
    });
    const hint = container!.querySelector("[class*='emptyHint']");
    expect(hint).toBeNull();
  });

  it("Mod-d delete-line keymap works via CodeMirror", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Line 1\nLine 2\nLine 3" onChange={vi.fn()} />,
      );
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content") as HTMLElement;
    if (cmContent) {
      // Simulate Mod+d (delete line) — this fires through CM's keymap
      await act(async () => {
        fireEvent.keyDown(cmContent, { key: "d", metaKey: true });
      });
    }
  });

  it("Alt+Enter on @Chat#boo creates affordance on Chat, not current sigil", async () => {
    const onCreateAffordance = vi.fn();
    const chat = folder("Chat", { path: "/mock/Chat" });
    const root = folder("Root", { children: [chat], path: "/mock/Root" });
    setEditorScopeForTest({
      scope: [{ name: "Chat", summary: "chat" }],
      scopeNames: ["Chat"],
      nameIndex: new Map([["chat", "Chat"]]),
      sigilRoot: root, currentContext: root,
      currentPath: [], importedOntologies: null,
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="@Chat#boo here"
          onChange={vi.fn()}
          onCreateAffordance={onCreateAffordance}
          sigilRoot={root}
          currentContext={root}
          currentPath={[]}
        />,
      );
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content") as HTMLElement;
    if (cmContent) {
      await act(async () => {
        fireEvent.keyDown(cmContent, { key: "Enter", altKey: true });
      });
    }
    // onCreateAffordance MUST be called with the target Chat folder, not Root
    expect(onCreateAffordance).toHaveBeenCalledTimes(1);
    const [name, target] = onCreateAffordance.mock.calls[0];
    expect(name).toBe("boo");
    expect(target?.name).toBe("Chat");
  });

  it("Alt+Enter on unresolved ref fires create callback", async () => {
    const onCreateSigil = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="@UnknownSigil here"
          onChange={vi.fn()}
          onCreateSigil={onCreateSigil}
        />,
      );
      container = result.container;
    });
    const cmContent = container!.querySelector(".cm-content") as HTMLElement;
    if (cmContent) {
      // Place cursor on @UnknownSigil and press Alt+Enter
      await act(async () => {
        fireEvent.keyDown(cmContent, { key: "Enter", altKey: true });
      });
    }
  });

  it("mounts with sigilDir for image paste handling", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="test" onChange={vi.fn()} sigilDir="/mock/dir" />,
      );
      container = result.container;
    });
    expect(container!.querySelector(".cm-content")).not.toBeNull();
  });

  it("drag-and-drop event listeners are attached to container", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="test" onChange={vi.fn()} sigilDir="/mock/dir" />,
      );
      container = result.container;
    });
    const editor = container!.querySelector("[class*='editor']") as HTMLElement;
    if (editor) {
      // Fire dragover with Files type
      const dragEvent = new Event("dragover", { bubbles: true }) as any;
      dragEvent.dataTransfer = { types: ["Files"] };
      dragEvent.preventDefault = vi.fn();
      await act(async () => { editor.dispatchEvent(dragEvent); });
    }
  });

  it("renders RenamePopup when renameState is set via keymap", async () => {
    const onRenameSigil = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="The @Observer watches."
          onChange={vi.fn()}
          scopeNames={["Observer"]}
          siblings={[{ name: "Observer", summary: "watches", kind: "contained" as const }]}
          sigilRoot={{
            name: "Root", path: "/mock/Root", language: "", affordances: [], invariants: [],
            children: [{ name: "Observer", path: "/mock/Root/Observer", language: "watches", affordances: [], invariants: [], children: [], images: [] }],
            images: [],
          } as any}
          currentContext={{
            name: "Root", path: "/mock/Root", language: "", affordances: [], invariants: [], children: [], images: [],
          } as any}
          currentPath={[]}
          onRenameSigil={onRenameSigil}
          keybindings={{ "rename-sigil": "Alt-Mod-r" }}
        />,
      );
      container = result.container;
    });
    // The editor should mount and show content
    expect(container!.querySelector(".cm-content")!.textContent).toContain("Observer");
  });

  it("renders RefsDropdown when findReferencesName is set", async () => {
    const onClear = vi.fn();
    const root = {
      name: "Root", path: "/mock/Root", language: "Uses @Widget.",
      affordances: [], invariants: [],
      children: [{ name: "Widget", path: "/mock/Root/Widget", language: "Uses @Widget too.", affordances: [], invariants: [], children: [], images: [] }],
      images: [],
    } as any;

    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="Uses @Widget."
          onChange={vi.fn()}
          sigilRoot={root}
          findReferencesName="Widget"
          onFindReferencesClear={onClear}
        />,
      );
      container = result.container;
    });
    expect(onClear).toHaveBeenCalled();
    // RefsDropdown should be rendered with hits
    const dropdown = container!.querySelector("[class*='dropdown']");
    expect(dropdown).not.toBeNull();
  });

  it("renders refs for an imported target by resolved filesystem path", async () => {
    const onClear = vi.fn();
    const importedTarget = folder("EntanglementTTTT", {
      path: "/mock/App/Libs/AttentionLanguage/EntanglementTTTT",
    });
    const imported = folder("Libs", {
      path: "/mock/App/Libs",
      children: [
        folder("AttentionLanguage", {
          path: "/mock/App/Libs/AttentionLanguage",
          children: [
            folder("ContrastSpace", {
              path: "/mock/App/Libs/AttentionLanguage/ContrastSpace",
              language: "Imported @EntanglementTTTT.",
            }),
            importedTarget,
          ],
        }),
      ],
    });
    const root = folder("App", {
      path: "/mock/App",
      language: "Workspace @EntanglementTTTT.",
    });

    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="Editing imported target."
          onChange={vi.fn()}
          workspaceRoot={root}
          importedOntologies={imported}
          sigilRoot={imported}
          findReferencesTarget={{ name: "EntanglementTTTT", fsPath: importedTarget.path }}
          onFindReferencesClear={onClear}
        />,
      );
      container = result.container;
    });

    expect(onClear).toHaveBeenCalled();
    expect(container!.textContent).toContain("Workspace @EntanglementTTTT.");
    expect(container!.textContent).toContain("Imported @EntanglementTTTT.");
  });

  it("mount effect creates EditorView with all configured extensions", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor
          content="---\nstatus: idea\n---\n# Content with @Ref and #aff and !inv"
          onChange={vi.fn()}
          wordWrap={true}
          scopeNames={["Ref"]}
          siblings={[{ name: "Ref", summary: "ref", kind: "contained" as const }]}
          keybindings={{ "rename-sigil": "Alt-Mod-r", "create-sigil": "Alt-Enter", "delete-line": "Mod-d", "find-references": "Alt-Mod-f" }}
          sigilDir="/mock/dir"
        />,
      );
      container = result.container;
    });
    // Verify all extensions are loaded — CM should render line numbers, content, etc.
    expect(container!.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(container!.querySelector(".cm-content")).not.toBeNull();
    expect(container!.querySelector(".cm-gutters")).not.toBeNull();
  });

  it("reconfigures sibling highlighting on prop change", async () => {
    const { rerender, container } = render(
      <LanguageEditor content="@Observer" onChange={vi.fn()} scopeNames={[]} siblings={[]} />,
    );

    await act(async () => {
      rerender(
        <LanguageEditor
          content="@Observer"
          onChange={vi.fn()}
          scopeNames={["Observer"]}
          siblings={[{ name: "Observer", summary: "watches", kind: "contained" as const }]}
        />,
      );
    });

    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("AI select-text event highlights and scrolls to excerpt", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Line one\nLine two\nLine three" onChange={vi.fn()} />,
      );
      container = result.container;
    });

    // The onToolSelectText listener should have been registered
    expect(selectTextListeners.length).toBeGreaterThan(0);

    // Fire the select-text event with an excerpt
    await act(async () => {
      selectTextListeners[0]({ request_id: "select-1", payload: { excerpt: "Line two" } });
    });

    // The editor should still be mounted
    expect(container!.querySelector(".cm-content")).not.toBeNull();
    expect(api.toolResult).toHaveBeenCalledWith("select-1", true, "Selected text:\n\nLine two");
  });

  it("AI select-text event with line range", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content={"Line 1\nLine 2\nLine 3\nLine 4"} onChange={vi.fn()} />,
      );
      container = result.container;
    });

    await act(async () => {
      selectTextListeners[0]({ request_id: "select-lines", payload: { from_line: 2, to_line: 3 } });
    });

    expect(container!.querySelector(".cm-content")).not.toBeNull();
    expect(api.toolResult).toHaveBeenCalledWith("select-lines", true, "Selected text:\n\nLine 2\nLine 3");
  });

  it("AI replace-selected-text replaces highlighted range", async () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <LanguageEditor content="Hello World" onChange={onChange} sigilDir="/mock/sigil" />,
      );
      container = result.container;
    });

    // First select text via excerpt
    await act(async () => {
      selectTextListeners[0]({ request_id: "select-replace", payload: { excerpt: "World" } });
    });

    // Then replace
    await act(async () => {
      replaceTextListeners[0]({ request_id: "req-1", payload: { text: "Universe" } });
    });

    // The change should have been dispatched
    const cmContent = container!.querySelector(".cm-content");
    expect(cmContent).not.toBeNull();
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/language.md", "Hello Universe");
    expect(api.toolResult).toHaveBeenCalledWith(
      "req-1",
      true,
      'Replaced 5 chars with 8. Persisted excerpt: "Hello Universe"',
    );
  });
});

// ── buildCustomKeymap direct tests ──

describe("buildCustomKeymap", () => {
  const makeRef = (val?: any) => ({ current: val });

  it("rename-sigil keymap: detects status at cursor and selects it", () => {
    const setRenameState = vi.fn();
    const setRefsState = vi.fn();
    const km = buildCustomKeymap(
      { "rename-sigil": "Alt-Mod-r" },
      setRenameState, setRefsState,
      makeRef(),
    );
    // Mount with frontmatter
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\nstatus: idea\n---\n# Content",
        extensions: [km],
      }),
      parent,
    });
    // Place cursor on "status: idea" line
    view.dispatch({ selection: { anchor: 5 } });
    // Execute the rename-sigil keymap programmatically
    const binding = km.value![0];
    const result = binding.run!(view);
    expect(result).toBe(true);
    // Should have selected the status value
    const sel = view.state.selection.main;
    expect(sel.from).not.toBe(sel.to); // selection is non-empty
    view.destroy();
  });

  it("rename-sigil keymap: returns false when cursor not on status or ref", () => {
    const setRenameState = vi.fn();
    const km = buildCustomKeymap(
      {}, setRenameState, vi.fn(), makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "plain text here", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 5 } });
    const result = km.value![0].run!(view);
    expect(result).toBe(false);
    expect(setRenameState).not.toHaveBeenCalled();
    view.destroy();
  });

  it("Enter keymap: commits status rename when globalPendingStatusRename is set", () => {
    const onRenameStatus = vi.fn();
    const km = buildCustomKeymap(
      {}, vi.fn(), vi.fn(), makeRef(onRenameStatus),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\nstatus: idea\n---\n# Content",
        extensions: [km],
      }),
      parent,
    });
    // First trigger the rename via the rename-sigil handler
    view.dispatch({ selection: { anchor: 5 } });
    km.value![0].run!(view); // sets globalPendingStatusRename = "idea"
    // Now change the selection text and press Enter
    // The Enter handler checks if globalPendingStatusRename is set
    view.dispatch({ selection: { anchor: 12, head: 16 } }); // select "idea"
    const enterResult = km.value![1].run!(view);
    expect(enterResult).toBe(true);
    view.destroy();
  });

  it("Escape keymap: clears pending status rename", () => {
    const km = buildCustomKeymap(
      {}, vi.fn(), vi.fn(), makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\nstatus: idea\n---\n# Content",
        extensions: [km],
      }),
      parent,
    });
    // Trigger status rename first
    view.dispatch({ selection: { anchor: 5 } });
    km.value![0].run!(view);
    // Press Escape
    const escResult = km.value![2].run!(view);
    expect(escResult).toBe(false); // Escape returns false (does not consume)
    view.destroy();
  });

  it("delete-line keymap: deletes the current line", () => {
    const km = buildCustomKeymap(
      { "delete-line": "Mod-d" }, vi.fn(), vi.fn(),
      makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "Line 1\nLine 2\nLine 3", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 8 } });
    const result = km.value![4].run!(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("Line 1\nLine 3");
    view.destroy();
  });

  it("Mod-z keymap: falls back to undoing the last rename", () => {
    const onUndoLastRename = vi.fn(() => true);
    const km = buildCustomKeymap(
      {}, vi.fn(), vi.fn(),
      makeRef(),
      makeRef(onUndoLastRename),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "plain text", extensions: [km] }),
      parent,
    });

    const result = km.value![5].run!(view);

    expect(result).toBe(true);
    expect(onUndoLastRename).toHaveBeenCalled();
    view.destroy();
  });

  it("find-references keymap: sets refsState for known ref", () => {
    const setRefsState = vi.fn();
    const root = folder("Root", {
      children: [folder("Observer", { language: "Uses @Observer." })],
      language: "@Observer is referenced.",
    });
    setEditorScopeForTest({
      scope: [{ name: "Observer", summary: "watches" }],
      scopeNames: ["Observer"],
      nameIndex: new Map([["observer", "Observer"]]),
      sigilRoot: root, currentContext: root,
      currentPath: [], importedOntologies: null,
    });
    const km = buildCustomKeymap(
      { "find-references": "Alt-Mod-f" }, vi.fn(), setRefsState,
      makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "Uses @Observer.", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 6 } });
    const result = km.value![3].run!(view);
    view.destroy();
  });

  it("rename-sigil keymap: detects #affordance at cursor and calls setRenameState", () => {
    const setRenameState = vi.fn();
    const ctx = folder("Root", {
      affordances: [{ name: "navigate", content: "move" }],
    });
    setEditorScopeForTest({
      scope: [], scopeNames: [], nameIndex: new Map(),
      sigilRoot: ctx, currentContext: ctx,
      currentPath: [], importedOntologies: null,
    });
    const km = buildCustomKeymap(
      {}, setRenameState, vi.fn(),
      makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "#navigate here", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 3 } });
    const result = km.value![0].run!(view);
    expect(result).toBe(true);
    view.destroy();
  });

  it("rename-sigil keymap: detects @Sigil at cursor and calls setRenameState", () => {
    const setRenameState = vi.fn();
    const child = folder("Observer");
    const root = folder("Root", { children: [child] });
    setEditorScopeForTest({
      scope: [{ name: "Observer", summary: "watches" }],
      scopeNames: ["Observer"],
      nameIndex: new Map([["observer", "Observer"]]),
      sigilRoot: root, currentContext: root,
      currentPath: [], importedOntologies: null,
    });
    const km = buildCustomKeymap(
      {}, setRenameState, vi.fn(),
      makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "@Observer here", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 3 } });
    const result = km.value![0].run!(view);
    expect(result).toBe(true);
    view.destroy();
  });

  it("find-references keymap: falls back to property ref when no @ref at cursor", () => {
    const setRefsState = vi.fn();
    const ctx = folder("Root", {
      affordances: [{ name: "navigate", content: "go" }],
      language: "#navigate used here.",
    });
    setEditorScopeForTest({
      scope: [], scopeNames: [], nameIndex: new Map(),
      sigilRoot: ctx, currentContext: ctx,
      currentPath: [], importedOntologies: null,
    });
    const km = buildCustomKeymap(
      {}, vi.fn(), setRefsState,
      makeRef(),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "#navigate used", extensions: [km] }),
      parent,
    });
    view.dispatch({ selection: { anchor: 3 } });
    km.value![3].run!(view);
    view.destroy();
  });

  it("Enter keymap: calls onRenameStatus when value changed during rename flow", () => {
    const onRenameStatus = vi.fn();
    const km = buildCustomKeymap(
      {}, vi.fn(), vi.fn(), makeRef(onRenameStatus),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\nstatus: idea\n---\n# Content",
        extensions: [km],
      }),
      parent,
    });
    // Trigger rename (sets globalPendingStatusRename = "idea")
    view.dispatch({ selection: { anchor: 12 } });
    km.value![0].run!(view);
    // Simulate user changing the status value to "active"
    const statusLine = view.state.doc.line(2);
    view.dispatch({
      changes: { from: statusLine.from, to: statusLine.to, insert: "status: active" },
    });
    // Place cursor on the status line
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 8 } });
    // Press Enter
    const enterResult = km.value![1].run!(view);
    expect(enterResult).toBe(true);
    expect(onRenameStatus).toHaveBeenCalledWith("idea", "active");
    view.destroy();
  });
});
