import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../state/AppContext";
import {
  useWorkspaceState, useWorkspaceDispatch, useWorkspaceActions,
  resolveCurrentFolder, scopeInfo, isImportedPath,
} from "../../state/WorkspaceContext";
import { useLayoutState, useLayoutDispatch } from "../../state/LayoutContext";
import { OntologyPanel } from "../OntologyTree/OntologyPanel";
import { DesignPartnerPanel } from "../DesignPartner/DesignPartnerPanel";
import { Breadcrumb } from "./Breadcrumb";
import type { ScopeEntry } from "./editorScope";
import { CompileStatusBar } from "./CompileStatusBar";
import { ConflictBanner } from "./ConflictBanner";
import { useCompileCheck, type RefError } from "../../hooks/useCompileCheck";
import { SigilFolder, DEFAULT_KEYBINDINGS } from "../../tauri";
import { setGlobalImportedOntologies } from "./editorScope";
import { useAutoSave, setBase } from "../../hooks/useAutoSave";
import { useActionDeps } from "../../hooks/useActionDeps";
import * as actions from "../../actions/workspace";
import { Atlas } from "./Atlas";
import { SigilEditor } from "./SigilEditor";
import {
  buildBreadcrumb as coreBuildBreadcrumb,
  buildLexicalScope as coreBuildLexicalScope,
  buildScope as coreBuildScope,
  resolve as coreResolve,
  makeSummary, findContext,
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

function buildBreadcrumb(root: Sigil, path: string[]): { name: string; path: string[] }[] {
  return [{ name: root.name, path: [] }, ...coreBuildBreadcrumb(root, path)];
}

export function Workspace() {
  const appState = useAppState();
  const ws = useWorkspaceState();
  const wsDispatch = useWorkspaceDispatch();
  const { navigate, back } = useWorkspaceActions();
  const layout = useLayoutState();
  const layoutDispatch = useLayoutDispatch();
  const { save } = useAutoSave();

  // Ephemeral UI state
  const [menuRenaming, setMenuRenaming] = useState<{ name: string } | null>(null);
  const menuRenameRef = useRef<HTMLInputElement>(null);
  const findReferencesNameRef = useRef<string | null>(null);

  const actionDeps = useActionDeps();

  // Invariant: open sigil is always visible and selected in ontology tree.
  // Ensures panel is open, on ontology tab, and all ancestor nodes are expanded.
  useEffect(() => {
    if (!layout.ontologyPanelOpen || layout.ontologyPanelTab !== "ontology") {
      layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "ontology" });
    }
    // Expand all ancestors of currentPath in the tree.
    // The root node has pathKey "" (from [].join("/")), imported paths start with "Imported Ontologies".
    const ancestorKeys: string[] = [];
    const isImported = ws.currentPath[0] === "Imported Ontologies";
    // The root "" must always be expanded
    ancestorKeys.push("");
    if (isImported) {
      ancestorKeys.push("Imported Ontologies");
    }
    for (let i = 1; i <= ws.currentPath.length; i++) {
      ancestorKeys.push(ws.currentPath.slice(0, i).join("/"));
    }
    const blocked = ancestorKeys.filter((k) => ws.collapsedPaths.includes(k));
    if (blocked.length > 0) {
      wsDispatch({ type: "SET_COLLAPSED_PATHS", paths: ws.collapsedPaths.filter((p) => !blocked.includes(p)) });
    }
  }, [ws.currentPath]);

  // Global keyboard shortcuts
  useEffect(() => {
    const kb = appState.settings.keybindings || DEFAULT_KEYBINDINGS;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesBinding(e, kb["navigate-back"] || "Alt-[")) {
        e.preventDefault();
        back();
        return;
      }
      if (matchesBinding(e, kb["facet-map"] || "Ctrl-5")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_CONTENT_TAB", tab: "atlas" });
        return;
      }
      if (matchesBinding(e, kb["panel-vision"] || "Ctrl-v")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "vision" });
        return;
      }
      if (matchesBinding(e, kb["panel-ontology"] || "Ctrl-g")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "ontology" });
        return;
      }
      if (matchesBinding(e, kb["rename-sigil"] || "Alt-Mod-r")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("sigil-rename-current"));
        }
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
  }, [ws, appState.settings.keybindings, layoutDispatch]);

  useEffect(() => {
    const handler = () => {
      if (ws.currentPath.length === 0) return;
      const ctx = resolveCurrentFolder(ws);
      if (ctx) setMenuRenaming({ name: ctx.name });
    };
    window.addEventListener("sigil-rename-current", handler);
    return () => window.removeEventListener("sigil-rename-current", handler);
  }, [ws]);

  useEffect(() => {
    if (menuRenaming && menuRenameRef.current) {
      menuRenameRef.current.focus();
      menuRenameRef.current.select();
    }
  }, [menuRenaming]);

  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  // Cancel any pending debounced state update when navigating away.
  // Also set the base version for the new path so conflict detection works.
  const prevPathKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const pathKey = ws.currentPath.join("/");
    if (pathKey !== prevPathKeyRef.current) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      prevPathKeyRef.current = pathKey;
      // Set base version for the newly navigated file.
      const { scopeRoot, scopePath } = scopeInfo(ws);
      const folder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;
      if (folder) {
        setBase(`${folder.path}/language.md`, folder.language);
      }
    }
  }, [ws.currentPath]);

  const handleContentChange = useCallback((content: string) => {
    const pathSnapshot = [...ws.currentPath];
    const pathKey = pathSnapshot.join("/");
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const folder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;
    if (!folder) return;
    save(`${folder.path}/language.md`, content);
    // Debounce the React state update — read fresh ws from ref to avoid stale closures
    if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
    dispatchTimerRef.current = setTimeout(() => {
      const current = wsRef.current;
      // Guard: if the user navigated away, don't update the wrong node
      if (current.currentPath.join("/") !== pathKey) return;
      const imported = isImportedPath(current);
      if (imported && current.spec.importedOntologies) {
        const updatedImported = updateFolderInTree(current.spec.importedOntologies, scopePath, (f) => ({
          ...f,
          language: content,
        }));
        wsDispatch({ type: "UPDATE_SPEC", spec: { ...current.spec, importedOntologies: updatedImported } });
      } else {
        const updatedRoot = updateFolderInTree(current.spec.root, pathSnapshot, (f) => ({
          ...f,
          language: content,
        }));
        wsDispatch({ type: "UPDATE_SPEC", spec: { ...current.spec, root: updatedRoot } });
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

  const handleCreateAffordance = useCallback(async (name: string, target?: SigilFolder) => {
    const folder = target ?? resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.createAffordance(folder, name, actionDeps);
  }, [ws, actionDeps]);

  const handleCreateInvariant = useCallback(async (name: string, target?: SigilFolder) => {
    const folder = target ?? resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.createInvariant(folder, name, actionDeps);
  }, [ws, actionDeps]);

  const handleRenameProperty = useCallback(async (kind: "affordance" | "invariant", oldName: string, newName: string) => {
    const folder = resolveCurrentFolder(ws);
    if (!folder) return;
    await actions.renameProperty(folder, kind, oldName, newName, actionDeps);
  }, [ws, actionDeps]);

  const handleRenameSigil = useCallback(async (oldName: string, newName: string) => {
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const result = coreResolve(scopeRoot as Sigil, scopePath, `@${oldName}`, ws.spec.importedOntologies);
    if (result && !result.ambiguous) {
      const target = result.target as SigilFolder;
      await actions.renameSigil(target.path, newName, actionDeps);
    }
  }, [ws, actionDeps]);

  const handleNavigateToSigil = useCallback((name: string) => {
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const importedSigil = ws.spec.importedOntologies ?? null;
    const result = coreResolve(scopeRoot as Sigil, scopePath, `@${name}`, importedSigil);
    if (result && !result.ambiguous) {
      const isImported = isImportedPath(ws);
      const navPath = isImported ? ["Imported Ontologies", ...result.path] : result.path;
      navigate(navPath);
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

  const compileResult = useCompileCheck(ws.spec.root, ws.spec.importedOntologies ?? null, ws.currentPath);

  // Memoize lexical scope — one call to sigil-core, same rules as resolution
  const { scope, scopeNames } = useMemo(() => {
    const importedSigil = ws.spec.importedOntologies ?? null;
    setGlobalImportedOntologies(importedSigil);
    const isImported = ws.currentPath[0] === "Imported Ontologies" && importedSigil;
    const pathPrefix = isImported ? ["Imported Ontologies"] : [];
    const items = coreBuildScope(scopeRoot as Sigil, scopePath, importedSigil);
    const refs: ScopeEntry[] = items.map((item) => ({
      name: item.name,
      summary: makeSummary(item.target),
      kind: item.kind === "ancestor" || item.kind === "proximity" ? "sibling" as const : item.kind as ScopeEntry["kind"],
      absolutePath: [...pathPrefix, ...item.path],
      libPrefix: item.kind === "lib" ? item.path[0] : undefined,
    }));
    return { scope: refs, scopeNames: refs.map((r) => r.name) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeFingerprint, scopePath]);

  // Preview highlighting needs Ref[] which includes affordances and invariants
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
        <ConflictBanner />
        {layout.contentTab === "atlas" ? (
          <Atlas />
        ) : (
          <SigilEditor
            sigil={currentFolder}
            content={content}
            onChange={handleContentChange}
            scope={scope}
            scopeNames={scopeNames}
            scopeRoot={scopeRoot}
            scopePath={scopePath}
            coreRefs={coreRefs}
            keybindings={appState.settings.keybindings as unknown as Record<string, string>}
            actionDeps={actionDeps}
            onCreateSigil={handleCreateSigil}
            onCreateAffordance={handleCreateAffordance}
            onCreateInvariant={handleCreateInvariant}
            onRenameSigil={handleRenameSigil}
            onRenameProperty={handleRenameProperty}
            onRenameStatus={handleRenameStatus}
            onNavigateToSigil={handleNavigateToSigil}
            onNavigateToAbsPath={(path) => navigate(path)}
            findReferencesName={findReferencesNameRef.current}
            onFindReferencesClear={() => { findReferencesNameRef.current = null; }}
            goToLine={ws.targetLine}
            onGoToLineDone={() => wsDispatch({ type: "CLEAR_TARGET_LINE" })}
          />
        )}
        <CompileStatusBar result={compileResult} onNavigateToError={(err: RefError) => {
          layoutDispatch({ type: "SET_CONTENT_TAB", tab: "language" });
          navigate(err.path, err.file === "language.md" ? err.line : undefined);
        }} />
      </div>
      <DesignPartnerPanel />

      {menuRenaming && (
        <div style={{ position: "fixed", inset: 0, zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "1rem", width: 280 }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>Rename to:</label>
            <input
              ref={menuRenameRef}
              style={{ width: "100%", padding: "0.4rem", fontSize: "0.9rem", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-primary)", color: "var(--text-primary)" }}
              defaultValue={menuRenaming.name}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSigil(menuRenaming.name, e.currentTarget.value);
                  setMenuRenaming(null);
                }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenuRenaming(null); }
              }}
              onBlur={(e) => {
                handleRenameSigil(menuRenaming.name, e.currentTarget.value);
                setMenuRenaming(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
