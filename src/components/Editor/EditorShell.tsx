import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState, useDocument } from "../../state/AppContext";
import { LeftPanel } from "../LeftPanel/LeftPanel";
import { ChatPanel } from "../RightPanel/ChatPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor, resolveRefName } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { Context, api, DEFAULT_KEYBINDINGS } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useSigil } from "../../hooks/useSigil";
import { SigilMap } from "./Map";
import styles from "./EditorShell.module.css";

type Facet = "ux" | "language" | "architecture" | "implementation";
const FACET_ORDER: Facet[] = ["ux", "language", "architecture", "implementation"];
const FACET_FILE: Record<Facet, string> = {
  ux: "ux.md",
  language: "language.md",
  architecture: "architecture.md",
  implementation: "implementation.md",
};

/** Match a browser KeyboardEvent against a CodeMirror key string (e.g. "Ctrl-1", "Alt-Mod-r"). */
function matchesBinding(e: KeyboardEvent, cmKey: string): boolean {
  const parts = cmKey.split("-");
  const keyChar = parts[parts.length - 1].toLowerCase();
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));

  const needsCtrl = mods.has("ctrl");
  const needsMod = mods.has("mod");
  const needsAlt = mods.has("alt");
  const needsShift = mods.has("shift");

  if (needsCtrl && !e.ctrlKey) return false;
  if (!needsCtrl && !needsMod && e.ctrlKey) return false;
  if (needsMod && !(e.metaKey || e.ctrlKey)) return false;
  if (!needsMod && e.metaKey) return false;
  if (needsAlt && !e.altKey) return false;
  if (!needsAlt && e.altKey) return false;
  if (needsShift && !e.shiftKey) return false;
  if (!needsShift && e.shiftKey) return false;

  return e.key.toLowerCase() === keyChar;
}

function findContext(root: Context, path: string[]): Context {
  let current = root;
  for (const segment of path) {
    const child = current.children.find((c) => c.name === segment);
    if (!child) return current;
    current = child;
  }
  return current;
}

function updateContextInTree(
  root: Context,
  path: string[],
  updater: (ctx: Context) => Context
): Context {
  if (path.length === 0) return updater(root);
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child) =>
      child.name === head ? updateContextInTree(child, rest, updater) : child
    ),
  };
}

function buildBreadcrumb(root: Context, path: string[]): { name: string; path: string[] }[] {
  const crumbs: { name: string; path: string[] }[] = [{ name: root.name, path: [] }];
  let current = root;
  for (let i = 0; i < path.length; i++) {
    const child = current.children.find((c) => c.name === path[i]);
    if (!child) break;
    crumbs.push({ name: child.name, path: path.slice(0, i + 1) });
    current = child;
  }
  return crumbs;
}

export function EditorShell() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const doc = useDocument();
  const { save } = useAutoSave();
  const { reload } = useSigil();

  // Non-language facet content loaded on demand
  const [facetContent, setFacetContent] = useState("");
  const facetContentRef = useRef(facetContent);
  facetContentRef.current = facetContent;

  // Load facet file when active facet or path changes
  const activeFacet: Facet = doc?.activeFacet ?? "language";
  const pathKey = doc?.currentPath.join("/") ?? "";
  const rootPath = doc?.sigil.root_path ?? "";

  useEffect(() => {
    if (!doc || activeFacet === "language") {
      setFacetContent("");
      return;
    }
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const filePath = `${ctx.path}/${FACET_FILE[activeFacet]}`;
    api.readFile(filePath)
      .then((text) => setFacetContent(text))
      .catch(() => setFacetContent(""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFacet, pathKey, rootPath]);

  // Global facet shortcuts
  useEffect(() => {
    if (!doc) return;
    const kb = state.settings.keybindings || DEFAULT_KEYBINDINGS;

    const handleKeyDown = (e: KeyboardEvent) => {
      let next: Facet | null = null;
      if (matchesBinding(e, kb["facet-ux"] || "Ctrl-1")) {
        next = "ux";
      } else if (matchesBinding(e, kb["facet-language"] || "Ctrl-2")) {
        next = "language";
      } else if (matchesBinding(e, kb["facet-architecture"] || "Ctrl-3")) {
        next = "architecture";
      } else if (matchesBinding(e, kb["facet-implementation"] || "Ctrl-4")) {
        next = "implementation";
      }
      if (next !== null) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { activeFacet: next, contentTab: "language" } });
        return;
      }
      if (matchesBinding(e, kb["facet-map"] || "Ctrl-5")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { contentTab: "map" } });
        return;
      }
      if (matchesBinding(e, kb["panel-vision"] || "Ctrl-v")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "vision", leftPanelOpen: true } });
        return;
      }
      if (matchesBinding(e, kb["panel-tree"] || "Ctrl-t")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "tree", leftPanelOpen: true } });
        return;
      }
      if (matchesBinding(e, kb["panel-ontology"] || "Ctrl-g")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "ontology", leftPanelOpen: true } });
        return;
      }
      if (matchesBinding(e, kb["facet-cycle"] || "Ctrl-/")) {
        e.preventDefault();
        const isContextMap = doc.contentTab === "map";
        if (isContextMap) {
          dispatch({ type: "UPDATE_DOCUMENT", updates: { activeFacet: "ux", contentTab: "language" } });
        } else {
          const idx = FACET_ORDER.indexOf(activeFacet);
          const nextIdx = idx + 1;
          if (nextIdx >= FACET_ORDER.length) {
            dispatch({ type: "UPDATE_DOCUMENT", updates: { contentTab: "map" } });
          } else {
            dispatch({ type: "UPDATE_DOCUMENT", updates: { activeFacet: FACET_ORDER[nextIdx], contentTab: "language" } });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [doc, activeFacet, state.settings.keybindings, dispatch]);

  const handleContentChange = useCallback((content: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const facet: Facet = doc.activeFacet ?? "language";

    if (facet === "language") {
      save(`${ctx.path}/language.md`, content);
      const updatedRoot = updateContextInTree(doc.sigil.root, doc.currentPath, (c) => ({
        ...c,
        domain_language: content,
      }));
      dispatch({ type: "UPDATE_SIGIL", sigil: { ...doc.sigil, root: updatedRoot } });
    } else {
      save(`${ctx.path}/${FACET_FILE[facet]}`, content);
      setFacetContent(content);
    }
  }, [doc, save, dispatch]);

  const handleCreateSigil = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    try {
      await api.createContext(ctx.path, name);
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Create sigil failed:", err);
    }
  }, [doc, reload]);

  const handleRenameSigil = useCallback(async (oldName: string, newName: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    // Check contained sigils first
    let target = ctx.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    // Then check neighbors
    if (!target && doc.currentPath.length > 0) {
      const parentPath = doc.currentPath.slice(0, -1);
      const parent = findContext(doc.sigil.root, parentPath);
      target = parent.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    }
    if (target) {
      try {
        await api.renameSigil(doc.sigil.root_path, target.path, newName);
        await reload(doc.sigil.root_path);
      } catch (err) {
        console.error("Rename sigil failed:", err);
      }
    }
  }, [doc, reload]);

  const handleNavigateToSigil = useCallback((name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    // Check if it's a contained sigil (resolving plurals)
    const containedNames = ctx.children.map((c) => c.name);
    const resolvedContained = resolveRefName(name, containedNames);
    if (resolvedContained) {
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: [...doc.currentPath, resolvedContained] } });
      return;
    }
    // Check if it's a neighbor — navigate to it at the same level
    if (doc.currentPath.length > 0) {
      const parentPath = doc.currentPath.slice(0, -1);
      const parent = findContext(doc.sigil.root, parentPath);
      const neighborNames = parent.children.filter((c) => c.name !== ctx.name).map((c) => c.name);
      const resolvedNeighbor = resolveRefName(name, neighborNames);
      if (resolvedNeighbor) {
        dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: [...parentPath, resolvedNeighbor] } });
      }
    }
  }, [doc, dispatch]);

  if (!doc) return null;

  const currentCtx = findContext(doc.sigil.root, doc.currentPath);
  const breadcrumbs = buildBreadcrumb(doc.sigil.root, doc.currentPath);

  // Vocabulary: contained sigils (your story's words) + siblings (your neighbors)
  const contained = currentCtx.children.map((c) => ({
    name: c.name,
    summary: (c.domain_language || "").split("\n").filter((l) => l.trim()).slice(0, 3).join("\n"),
    kind: "contained" as const,
  }));
  const siblings = (() => {
    if (doc.currentPath.length === 0) return [];
    const containingPath = doc.currentPath.slice(0, -1);
    const containingSigil = findContext(doc.sigil.root, containingPath);
    return containingSigil.children
      .filter((c) => c.name !== currentCtx.name)
      .map((c) => ({
        name: c.name,
        summary: (c.domain_language || "").split("\n").filter((l) => l.trim()).slice(0, 3).join("\n"),
        kind: "sibling" as const,
      }));
  })();
  const allRefs = [...contained, ...siblings];
  const allRefNames = allRefs.map((s) => s.name);

  const content = activeFacet === "language" ? currentCtx.domain_language : facetContent;

  return (
    <div className={styles.shell}>
      <LeftPanel />
      <div className={styles.center}>
        <Breadcrumb
          crumbs={breadcrumbs}
          onNavigate={(path) =>
            dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })
          }
        />
        <EditorToolbar />
        <div className={styles.editorArea}>
          {(doc.contentTab || "language") === "map" ? (
            <SigilMap />
          ) : (
            <>
              {(doc.editorMode === "edit" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
                  <MarkdownEditor
                    content={content}
                    onChange={handleContentChange}
                    siblingNames={allRefNames}
                    siblings={allRefs}
                    sigilRoot={doc.sigil.root}
                    wordWrap={doc.wordWrap}
                    onCreateSigil={handleCreateSigil}
                    onRenameSigil={handleRenameSigil}
                    onNavigateToSigil={handleNavigateToSigil}
                    onNavigateToAbsPath={(path) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })}
                    keybindings={state.settings.keybindings as unknown as Record<string, string>}
                  />
                </div>
              )}
              {(doc.editorMode === "preview" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} siblingNames={allRefNames} siblings={allRefs} />
                </div>
              )}
            </>
          )}
        </div>
        <SubContextBar context={currentCtx} />
      </div>
      <ChatPanel />
    </div>
  );
}
