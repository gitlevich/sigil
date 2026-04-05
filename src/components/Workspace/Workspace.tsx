import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppState } from "../../state/AppContext";
import {
  useWorkspaceState, useWorkspaceDispatch, useWorkspaceActions,
  resolveCurrentFolder, scopeInfo, isImportedPath,
} from "../../state/WorkspaceContext";
import { useNarratingState, useNarratingDispatch } from "../../state/NarratingContext";
import { OntologyPanel } from "../OntologyTree/OntologyPanel";
import { DesignPartnerPanel } from "../DesignPartner/DesignPartnerPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor, SiblingInfo } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { SigilFolder, DEFAULT_KEYBINDINGS } from "../../tauri";
import { setGlobalImportedOntologies } from "./sigilExtensions";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useToast } from "../../hooks/useToast";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import { Atlas } from "./Atlas";
import { SigilPropertyEditor } from "./SigilPropertyEditor";
import {
  buildBreadcrumb as coreBuildBreadcrumb,
  buildLexicalScope as coreBuildLexicalScope,
  makeSummary, resolveRefName, findContext,
} from "sigil-core";
import type { Sigil } from "sigil-core";
import styles from "./Workspace.module.css";

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

function updateFolderInTree(
  root: SigilFolder,
  path: string[],
  updater: (folder: SigilFolder) => SigilFolder
): SigilFolder {
  if (path.length === 0) return updater(root);
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child) =>
      child.name === head ? updateFolderInTree(child, rest, updater) : child
    ),
  };
}

/** Build the full lexical scope for the current path: children → ancestry levels → root. */
function buildLexicalScope(
  root: SigilFolder,
  currentPath: string[],
): SiblingInfo[] {
  const refs: SiblingInfo[] = [];
  const seen = new Set<string>();
  const currentFolder = findContext(root as Sigil, currentPath) as SigilFolder;
  if (!currentFolder) return refs;

  const add = (name: string, sigil: Sigil, kind: "contained" | "sibling", absolutePath: string[]) => {
    if (!seen.has(name)) {
      seen.add(name);
      refs.push({ name, summary: makeSummary(sigil), kind, absolutePath });
    }
  };

  // Innermost: children of current sigil
  for (const c of currentFolder.children) {
    add(c.name, c, "contained", [...currentPath, c.name]);
  }

  // Walk up the ancestry chain
  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root as Sigil, levelPath);
    const parentPath = levelPath.slice(0, -1);
    const parentSigil = findContext(root as Sigil, parentPath);
    if (!levelSigil || !parentSigil) break;

    add(levelSigil.name, levelSigil, "sibling", levelPath);

    for (const c of parentSigil.children) {
      if (c.name !== levelSigil.name) {
        add(c.name, c, "sibling", [...parentPath, c.name]);
      }
    }
  }

  // Root itself
  add(root.name, root, "sibling", []);

  return refs;
}

/** Flatten all descendants of the Ontologies sigil into the global scope. */
function flattenOntologyRefs(
  sigil: Sigil,
  basePath: string[],
  seen: Set<string>,
  ontologyName: string,
): SiblingInfo[] {
  const refs: SiblingInfo[] = [];
  for (const child of sigil.children) {
    const childPath = [...basePath, child.name];
    if (!seen.has(child.name)) {
      seen.add(child.name);
      refs.push({ name: child.name, summary: makeSummary(child), kind: "lib", absolutePath: childPath, libPrefix: ontologyName });
    }
    refs.push(...flattenOntologyRefs(child, childPath, seen, ontologyName));
  }
  return refs;
}

function buildBreadcrumb(root: Sigil, path: string[]): { name: string; path: string[] }[] {
  return [{ name: root.name, path: [] }, ...coreBuildBreadcrumb(root, path)];
}

export function Workspace() {
  const appState = useAppState();
  const ws = useWorkspaceState();
  const wsDispatch = useWorkspaceDispatch();
  const { navigate, reload } = useWorkspaceActions();
  const narrating = useNarratingState();
  const narratingDispatch = useNarratingDispatch();
  const { save } = useAutoSave();
  const { addToast } = useToast();

  // Ephemeral UI state
  const findReferencesNameRef = useRef<string | null>(null);

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async (rootPath: string) => {
      const spec = await reload();
      return spec;
    },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);

  // Global keyboard shortcuts
  useEffect(() => {
    const kb = appState.settings.keybindings || DEFAULT_KEYBINDINGS;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesBinding(e, kb["facet-map"] || "Ctrl-5")) {
        e.preventDefault();
        narratingDispatch({ type: "SET_CONTENT_TAB", tab: "atlas" });
        return;
      }
      if (matchesBinding(e, kb["panel-vision"] || "Ctrl-v")) {
        e.preventDefault();
        narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "vision" });
        return;
      }
      if (matchesBinding(e, kb["panel-ontology"] || "Ctrl-g")) {
        e.preventDefault();
        narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "ontology" });
        return;
      }
      if (matchesBinding(e, kb["find-references"] || "Alt-Mod-f")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm) {
          e.preventDefault();
          const currentFolder = resolveCurrentFolder(ws);
          if (currentFolder) findReferencesNameRef.current = currentFolder.name;
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [ws, appState.settings.keybindings, narratingDispatch]);

  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending debounced state update when navigating away.
  const prevPathKeyRef = useRef(ws.currentPath.join("/"));
  useEffect(() => {
    const pathKey = ws.currentPath.join("/");
    if (pathKey !== prevPathKeyRef.current) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      prevPathKeyRef.current = pathKey;
    }
  }, [ws.currentPath]);

  const handleContentChange = useCallback((content: string) => {
    const pathSnapshot = [...ws.currentPath];
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const folder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;
    if (!folder) return;
    save(`${folder.path}/language.md`, content);
    // Debounce the React state update
    if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
    dispatchTimerRef.current = setTimeout(() => {
      const isImported = isImportedPath(ws);
      if (isImported && ws.spec.importedOntologies) {
        const updatedImported = updateFolderInTree(ws.spec.importedOntologies, scopePath, (f) => ({
          ...f,
          language: content,
        }));
        wsDispatch({ type: "UPDATE_SPEC", spec: { ...ws.spec, importedOntologies: updatedImported } });
      } else {
        const updatedRoot = updateFolderInTree(ws.spec.root, pathSnapshot, (f) => ({
          ...f,
          language: content,
        }));
        wsDispatch({ type: "UPDATE_SPEC", spec: { ...ws.spec, root: updatedRoot } });
      }
    }, 300);
  }, [ws, save, wsDispatch]);

  const currentFolder = resolveCurrentFolder(ws);

  const handleCreateSigil = useCallback(async (name: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.createSigil(folder, name, actionDeps);
  }, [ws, actionDeps]);

  const handleRenameStatus = useCallback(async (_oldValue: string, newValue: string) => {
    if (!newValue.trim()) return;
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.updateStatus(folder, newValue, actionDeps);
  }, [ws, actionDeps]);

  const handleCreateAffordance = useCallback(async (name: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.createAffordance(folder, name, actionDeps);
  }, [ws, actionDeps]);

  const handleCreateInvariant = useCallback(async (name: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.createInvariant(folder, name, actionDeps);
  }, [ws, actionDeps]);

  const handleRenameProperty = useCallback(async (kind: "affordance" | "invariant", oldName: string, newName: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.renameProperty(folder, kind, oldName, newName, actionDeps);
  }, [ws, actionDeps]);

  const handleRenameSigil = useCallback(async (oldName: string, newName: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    const { scopeRoot, scopePath } = scopeInfo(ws);
    let target = folder.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    if (!target && ws.currentPath.length > 0) {
      const parentPath = scopePath.slice(0, -1);
      const parent = findContext(scopeRoot as Sigil, parentPath) as SigilFolder | null;
      target = parent?.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    }
    if (target) {
      await actions.renameSigil(target.path, newName, actionDeps);
    }
  }, [ws, actionDeps]);

  const handleNavigateToSigil = useCallback((name: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    // Check contained sigils
    const containedNames = folder.children.map((c) => c.name);
    const resolvedContained = resolveRefName(name, containedNames);
    if (resolvedContained) {
      navigate([...ws.currentPath, resolvedContained]);
      return;
    }
    // Check neighbors
    if (ws.currentPath.length > 0) {
      const parentPath = ws.currentPath.slice(0, -1);
      const { scopeRoot, scopePath } = scopeInfo(ws);
      const resolvedParentPath = isImportedPath(ws) ? scopePath.slice(0, -1) : parentPath;
      const parent = findContext(scopeRoot as Sigil, resolvedParentPath);
      const neighborNames = parent ? parent.children.filter((c) => c.name !== folder.name).map((c) => c.name) : [];
      const resolvedNeighbor = resolveRefName(name, neighborNames);
      if (resolvedNeighbor) {
        navigate([...parentPath, resolvedNeighbor]);
      }
    }
  }, [ws, navigate]);

  // Stable fingerprint of tree structure (names only, ignoring content changes)
  const treeFingerprint = useMemo(() => {
    function walk(sigil: Sigil): string {
      return sigil.name + "(" + sigil.children.map(walk).join(",") + ")";
    }
    let fp = walk(ws.spec.root);
    if (ws.spec.importedOntologies) fp += "|" + walk(ws.spec.importedOntologies);
    return fp;
  }, [ws.spec.root, ws.spec.importedOntologies]);

  const { scopeRoot, scopePath } = scopeInfo(ws);

  // Memoize lexical scope
  const { allRefs, allRefNames } = useMemo(() => {
    const refs: SiblingInfo[] = buildLexicalScope(scopeRoot, scopePath);
    const seenNames = new Set(refs.map((r) => r.name));
    const importedSigil = ws.spec.importedOntologies ?? null;
    setGlobalImportedOntologies(importedSigil);
    if (importedSigil) {
      for (const ontology of importedSigil.children) {
        if (!seenNames.has(ontology.name)) {
          seenNames.add(ontology.name);
          refs.push({ name: ontology.name, summary: makeSummary(ontology), kind: "lib", absolutePath: ["Imported Ontologies", ontology.name], libPrefix: ontology.name });
        }
        refs.push(...flattenOntologyRefs(ontology, ["Imported Ontologies", ontology.name], seenNames, ontology.name));
      }
    }
    return { allRefs: refs, allRefNames: refs.map((r) => r.name) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeFingerprint, scopePath]);

  // Core refs for preview highlighting
  const coreRefs = useMemo(() => {
    return coreBuildLexicalScope(scopeRoot as Sigil, scopePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeFingerprint, scopePath]);

  // Stale currentPath — reset to root
  if (!currentFolder) {
    navigate([]);
    return null;
  }

  const isImported = isImportedPath(ws);
  const breadcrumbs = isImported
    ? [{ name: "Imported Ontologies", path: ["Imported Ontologies"] }, ...buildBreadcrumb(ws.spec.importedOntologies!, scopePath)]
    : buildBreadcrumb(ws.spec.root, ws.currentPath);
  const content = currentFolder.language;

  return (
    <div className={styles.shell}>
      <OntologyPanel />
      <div className={styles.center}>
        <Breadcrumb
          crumbs={breadcrumbs}
          onNavigate={(path) => navigate(path)}
        />
        <EditorToolbar />
        {narrating.contentTab !== "atlas" && (
          <SigilPropertyEditor
            sigilPath={currentFolder.path}
            filePrefix="affordance"
            title="Affordances"
            refPrefix="#"
            color="#3d9e8c"
            namePlaceholder="I need to..."
            contentPlaceholder="so that..."
            items={currentFolder.affordances}
            siblings={allRefs}
            siblingNames={allRefNames}
            sigilRoot={scopeRoot}
            currentContext={currentFolder}
            currentPath={scopePath}
            onCreateAffordance={handleCreateAffordance}
            onCreateInvariant={handleCreateInvariant}
            onRenameSigil={handleRenameSigil}
            onRenameProperty={handleRenameProperty}
            onNavigateToSigil={handleNavigateToSigil}
            onNavigateToAbsPath={(path) => navigate(path)}
            keybindings={appState.settings.keybindings as unknown as Record<string, string>}
            actionDeps={actionDeps}
          />
        )}
        <div className={styles.editorArea}>
          {narrating.contentTab === "atlas" ? (
            <Atlas />
          ) : (
            <>
              {(narrating.editorMode === "edit" || narrating.editorMode === "split") && (
                <div className={narrating.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
                  <MarkdownEditor
                    content={content}
                    onChange={handleContentChange}
                    siblingNames={allRefNames}
                    siblings={allRefs}
                    sigilRoot={scopeRoot}
                    currentContext={currentFolder}
                    currentPath={scopePath}
                    sigilDir={currentFolder.path}
                    wordWrap={narrating.wordWrap}
                    onCreateSigil={handleCreateSigil}
                    onCreateAffordance={handleCreateAffordance}
                    onCreateInvariant={handleCreateInvariant}
                    onRenameSigil={handleRenameSigil}
                    onRenameProperty={handleRenameProperty}
                    onRenameStatus={handleRenameStatus}
                    onNavigateToSigil={handleNavigateToSigil}
                    onNavigateToAbsPath={(path) => navigate(path)}
                    keybindings={appState.settings.keybindings as unknown as Record<string, string>}
                    findReferencesName={findReferencesNameRef.current}
                    onFindReferencesClear={() => { findReferencesNameRef.current = null; }}
                  />
                </div>
              )}
              {(narrating.editorMode === "preview" || narrating.editorMode === "split") && (
                <div className={narrating.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} refs={coreRefs} sigilDir={currentFolder.path} images={currentFolder.images} onContentChange={handleContentChange} />
                </div>
              )}
            </>
          )}
        </div>
        {narrating.contentTab !== "atlas" && (
          <SigilPropertyEditor
            sigilPath={currentFolder.path}
            filePrefix="invariant"
            title="Invariants"
            refPrefix="!"
            color="#e8a040"
            namePlaceholder="what must hold..."
            contentPlaceholder="because..."
            items={currentFolder.invariants}
            siblings={allRefs}
            siblingNames={allRefNames}
            sigilRoot={scopeRoot}
            currentContext={currentFolder}
            currentPath={scopePath}
            onCreateAffordance={handleCreateAffordance}
            onCreateInvariant={handleCreateInvariant}
            onRenameSigil={handleRenameSigil}
            onRenameProperty={handleRenameProperty}
            onNavigateToSigil={handleNavigateToSigil}
            onNavigateToAbsPath={(path) => navigate(path)}
            keybindings={appState.settings.keybindings as unknown as Record<string, string>}
            actionDeps={actionDeps}
          />
        )}
        <SubContextBar context={currentFolder} />
      </div>
      <DesignPartnerPanel />
    </div>
  );
}
