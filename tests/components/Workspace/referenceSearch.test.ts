import { describe, expect, it } from "vitest";
import { findAllReferencesInTree, findReferencesInWorkspace } from "../../../src/components/Workspace/referenceSearch";
import type { SigilFolder } from "../../../src/tauri";

function folder(name: string, opts?: {
  language?: string;
  path?: string;
  children?: SigilFolder[];
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
  } as SigilFolder;
}

describe("findReferencesInWorkspace", () => {
  it("finds renamed imported ontology references across the workspace and Libs by resolved target path", () => {
    const importedEntanglement = folder("EntanglementTTTT", {
      path: "/mock/App/Libs/AttentionLanguage/EntanglementTTTT",
      isImported: true,
    });
    const attentionLanguage = folder("AttentionLanguage", {
      path: "/mock/App/Libs/AttentionLanguage",
      isImported: true,
      children: [
        folder("ContrastSpace", {
          path: "/mock/App/Libs/AttentionLanguage/ContrastSpace",
          language: "Structure sees @EntanglementTTTT.",
          isImported: true,
        }),
        importedEntanglement,
      ],
    });
    const libs = folder("Libs", {
      path: "/mock/App/Libs",
      isImported: true,
      children: [attentionLanguage],
    });
    const root = folder("App", {
      path: "/mock/App",
      language: "Local use @EntanglementTTTT.",
      children: [
        folder("Outside", {
          path: "/mock/App/Outside",
          language: "Qualified @AttentionLanguage@EntanglementTTTT and lower @entanglementtttt.",
        }),
      ],
    });

    const hits = findReferencesInWorkspace(root, libs, {
      name: "EntanglementTTTT",
      fsPath: importedEntanglement.path,
    });

    expect(hits.map((hit) => hit.contextPath)).toEqual([
      [],
      ["Outside"],
      ["Imported Ontologies", "AttentionLanguage", "ContrastSpace"],
    ]);
    expect(hits.map((hit) => hit.line)).toEqual([
      "Local use @EntanglementTTTT.",
      "Qualified @AttentionLanguage@EntanglementTTTT and lower @entanglementtttt.",
      "Structure sees @EntanglementTTTT.",
    ]);
  });

  it("does not count a local shadow as a reference to the imported target", () => {
    const importedEntanglement = folder("EntanglementTTTT", {
      path: "/mock/App/Libs/AttentionLanguage/EntanglementTTTT",
      isImported: true,
    });
    const libs = folder("Libs", {
      path: "/mock/App/Libs",
      isImported: true,
      children: [
        folder("AttentionLanguage", {
          path: "/mock/App/Libs/AttentionLanguage",
          isImported: true,
          children: [importedEntanglement],
        }),
      ],
    });
    const root = folder("App", {
      path: "/mock/App",
      language: "This resolves locally: @EntanglementTTTT.",
      children: [
        folder("LocalVocabulary", {
          path: "/mock/App/LocalVocabulary",
          children: [folder("EntanglementTTTT", { path: "/mock/App/LocalVocabulary/EntanglementTTTT" })],
        }),
      ],
    });

    const hits = findReferencesInWorkspace(root, libs, {
      name: "EntanglementTTTT",
      fsPath: importedEntanglement.path,
    });

    expect(hits).toEqual([]);
  });

  it("falls back to symbol matching when no target path is supplied", () => {
    const root = folder("App", { language: "Uses @Widget and @Box#render." });

    expect(findReferencesInWorkspace(root, null, { name: "Widget" })).toHaveLength(1);
    expect(findReferencesInWorkspace(root, null, { name: "Box" })).toHaveLength(1);
  });
});

describe("findAllReferencesInTree", () => {
  it("keeps property reference lookup and skips inline code", () => {
    const root = folder("App", {
      language: [
        "Use #navigate here.",
        "Check !speed-limit here.",
        "Ignore `#navigate` in code.",
      ].join("\n"),
    });

    expect(findAllReferencesInTree(root, "navigate", [])).toEqual([
      { contextName: "App", contextPath: [], line: "Use #navigate here." },
    ]);
    expect(findAllReferencesInTree(root, "speed limit", [])).toEqual([
      { contextName: "App", contextPath: [], line: "Check !speed-limit here." },
    ]);
  });
});
