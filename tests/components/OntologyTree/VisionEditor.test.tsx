/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Idea, SigilFolder } from "../../../src/tauri";
import { WorkspaceProvider } from "../../../src/state/WorkspaceContext";
import { ToastContext } from "../../../src/hooks/useToast";
import type { Toast } from "../../../src/hooks/useToast";
import {
  VisionEditor,
  buildVisionRefs,
  buildVisionScope,
} from "../../../src/components/OntologyTree/VisionEditor";

vi.mock("../../../src/tauri", () => ({
  api: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readSigil: vi.fn(),
    createSigil: vi.fn(),
    renameSigil: vi.fn(),
    writeImageBytes: vi.fn(),
    readImageBase64: vi.fn(),
  },
}));

function folder(name: string, opts?: {
  language?: string;
  children?: SigilFolder[];
  path?: string;
  isImported?: boolean;
}): SigilFolder {
  return {
    name,
    path: opts?.path ?? `/mock/${name}`,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
    images: [],
    isImported: opts?.isImported,
  };
}

function spec(root: SigilFolder, vision: string, importedOntologies?: SigilFolder): Idea {
  return {
    name: root.name,
    rootPath: root.path,
    vision,
    root,
    importedOntologies,
  };
}

const toastCtx = { toasts: [] as Toast[], addToast: vi.fn(), removeToast: vi.fn() };

function Wrapper({ idea, children }: { idea: Idea; children: ReactNode }) {
  return (
    <ToastContext.Provider value={toastCtx}>
      <WorkspaceProvider spec={idea}>{children}</WorkspaceProvider>
    </ToastContext.Provider>
  );
}

describe("VisionEditor", () => {
  beforeEach(() => {
    toastCtx.addToast.mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    // @ts-expect-error jsdom only needs the shape CodeMirror asks for.
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => []),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => ({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      })),
    });
  });

  it("renders root-scoped references as links in preview", async () => {
    const root = folder("App", {
      children: [
        folder("Model", { language: "The model describes the system." }),
      ],
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <Wrapper idea={spec(root, "See @model before changing behavior.")}>
          <VisionEditor />
        </Wrapper>,
      );
    });

    fireEvent.click(rendered!.getByRole("button", { name: "Preview" }));

    const link = rendered!.container.querySelector(".ref-contained");
    expect(link?.textContent).toBe("@model");
  });

  it("includes imported ontology refs in vision scope and preview refs", () => {
    const root = folder("App");
    const importedOntologies = folder("Imported Ontologies", {
      children: [
        folder("AttentionLanguage", {
          children: [folder("Observation", { language: "Observation summary" })],
          isImported: true,
        }),
      ],
    });

    const scope = buildVisionScope(root, importedOntologies);
    const observation = scope.find((entry) => entry.name === "Observation");

    expect(observation?.kind).toBe("lib");
    expect(observation?.absolutePath).toEqual([
      "Imported Ontologies",
      "AttentionLanguage",
      "Observation",
    ]);
    expect(buildVisionRefs(root, scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@", name: "Observation" }),
      ]),
    );
  });
});
