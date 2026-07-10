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
import { HearingStatusBar } from "./HearingStatusBar";
import { ConflictBanner } from "./ConflictBanner";
import { ConflictToast } from "./ConflictToast";
import { ConflictStatusBar } from "./ConflictStatusBar";
import { GlobalStatusBar } from "./GlobalStatusBar";
import { useCompileCheck, type RefError } from "../../hooks/useCompileCheck";
import { useHearing, type HearingEvent } from "../../hooks/useHearing";
import { useSpellbook } from "../../hooks/useSpellbook";
import { useDPCurated } from "../../hooks/useDPCurated";
import { useFrameTick } from "../../hooks/useFrameTick";
import { selectedProvider, fallbackProvider } from "../../tauri";
import { useExperience } from "../../state/ExperienceContext";
import { ObservationChip, type Observation } from "../DesignPartner/ObservationChip";
import { SigilFolder, DEFAULT_KEYBINDINGS } from "../../tauri";
import { setGlobalImportedOntologies } from "./editorScope";
import { useAutoSave, setBase } from "../../hooks/useAutoSave";
import { useActionDeps } from "../../hooks/useActionDeps";
import * as actions from "../../actions/workspace";
import type { RenameSigilResult } from "../../actions/workspace";
import type { ReferenceTarget } from "./referenceSearch";
import { currentPathAfterRename } from "./renamePath";
import { recordCompletedRename, undoLastRename } from "./renameUndo";
import { EditorToolbar } from "./EditorToolbar";
import { Atlas } from "./Atlas";
import { SpatialDesktop } from "./SpatialDesktop";
import { FlowingSplit } from "sigil-core/react/FlowingSplit";
import { matchesKeybinding } from "sigil-core/keybinding";
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
  const { navigate, back, reload } = useWorkspaceActions();
  const layout = useLayoutState();
  const layoutDispatch = useLayoutDispatch();
  const { save } = useAutoSave();

  // Ephemeral UI state
  const [menuRenaming, setMenuRenaming] = useState<{ name: string } | null>(null);
  const [refreshSerial, setRefreshSerial] = useState(0);
  const menuRenameRef = useRef<HTMLInputElement>(null);
  const [findReferencesTarget, setFindReferencesTarget] = useState<ReferenceTarget | null>(null);
  const renameUndoStackRef = useRef<RenameSigilResult[]>([]);
  const undoingRenameRef = useRef(false);

  const actionDeps = useActionDeps();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const preserveCurrentPathAfterRename = useCallback((
    pathSnapshot: string[],
    selectedFolderPath: string | null | undefined,
    result: RenameSigilResult | null,
  ) => {
    const nextPath = currentPathAfterRename(pathSnapshot, selectedFolderPath, result);
    if (nextPath) wsDispatch({ type: "REPLACE_CURRENT_PATH", path: nextPath });
  }, [wsDispatch]);

  const handleUndoLastRename = useCallback((): boolean => {
    return undoLastRename(
      renameUndoStackRef,
      undoingRenameRef,
      async (targetPath, newName) => {
        const current = wsRef.current;
        const selectedBeforeRename = resolveCurrentFolder(current);
        const pathBeforeRename = [...current.currentPath];
        const result = await actions.renameSigil(targetPath, newName, actionDeps, { reloadAfter: false });
        preserveCurrentPathAfterRename(pathBeforeRename, selectedBeforeRename?.path, result);
        if (result) await reload();
        return result;
      },
    );
  }, [actionDeps, preserveCurrentPathAfterRename, reload]);

  // Keep the ontology tree's expansion in sync with the inhabited sigil, so
  // that whenever the panel is next opened the current sigil is already
  // revealed. Do NOT force the panel open or switch tabs — the user's choice
  // to fold the panel for flow is authoritative and must survive navigation.
  useEffect(() => {
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
      // Ctrl+Tab — close both side panels (ontology + design partner) for flow.
      if (e.key === "Tab" && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: false });
        layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: false });
        return;
      }
      if (matchesKeybinding(e, kb["navigate-back"] || "Alt-[")) {
        e.preventDefault();
        back();
        return;
      }
      if (matchesKeybinding(e, kb["facet-map"] || "Ctrl-5")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_CONTENT_TAB", tab: layout.contentTab === "atlas" ? "language" : "atlas" });
        return;
      }
      if (matchesKeybinding(e, "Ctrl-6")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "experience" });
        return;
      }
      if (matchesKeybinding(e, "Ctrl-7")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_CONTENT_TAB", tab: layout.contentTab === "space" ? "language" : "space" });
        return;
      }
      if (matchesKeybinding(e, kb["panel-vision"] || "Ctrl-v")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "vision" });
        return;
      }
      if (matchesKeybinding(e, kb["panel-ontology"] || "Ctrl-g")) {
        e.preventDefault();
        layoutDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "ontology" });
        return;
      }
      if (matchesKeybinding(e, kb["rename-sigil"] || "Alt-Mod-r")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("sigil-rename-current"));
        }
        return;
      }
      if (matchesKeybinding(e, kb["find-references"] || "Alt-Mod-f")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm) {
          e.preventDefault();
          const currentFolder = resolveCurrentFolder(ws);
          if (currentFolder) setFindReferencesTarget({ name: currentFolder.name, fsPath: currentFolder.path });
        }
        return;
      }
      if (matchesKeybinding(e, "Mod-z")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm && renameUndoStackRef.current.length > 0) {
          e.preventDefault();
          handleUndoLastRename();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [ws, appState.settings.keybindings, layout.contentTab, layoutDispatch, handleUndoLastRename]);

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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RenameSigilResult>).detail;
      recordCompletedRename(renameUndoStackRef, detail, undoingRenameRef);
    };
    window.addEventListener("sigil-rename-completed", handler);
    return () => window.removeEventListener("sigil-rename-completed", handler);
  }, []);

  const handleRefreshFromDisk = useCallback(async () => {
    await reload();
    setRefreshSerial((serial) => serial + 1);
    actionDeps.confirm?.("Reloaded from disk.");
  }, [reload, actionDeps]);

  useEffect(() => {
    const handler = () => { void handleRefreshFromDisk(); };
    const keyHandler = (e: KeyboardEvent) => {
      if (!matchesKeybinding(e, "Mod-r")) return;
      e.preventDefault();
      void handleRefreshFromDisk();
    };
    window.addEventListener("sigil-refresh-from-disk", handler);
    window.addEventListener("keydown", keyHandler, true);
    return () => {
      window.removeEventListener("sigil-refresh-from-disk", handler);
      window.removeEventListener("keydown", keyHandler, true);
    };
  }, [handleRefreshFromDisk]);

  useEffect(() => {
    if (menuRenaming && menuRenameRef.current) {
      menuRenameRef.current.focus();
      menuRenameRef.current.select();
    }
  }, [menuRenaming]);

  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const selectedBeforeRename = resolveCurrentFolder(ws);
    const pathBeforeRename = [...ws.currentPath];
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const result = coreResolve(scopeRoot as Sigil, scopePath, `@${oldName}`, ws.spec.importedOntologies);
    if (result && !result.ambiguous) {
      const target = result.target as SigilFolder;
      const renameResult = await actions.renameSigil(target.path, newName, actionDeps, { reloadAfter: false });
      recordCompletedRename(renameUndoStackRef, renameResult, undoingRenameRef);
      preserveCurrentPathAfterRename(pathBeforeRename, selectedBeforeRename?.path, renameResult);
      if (renameResult) await reload();
    }
  }, [ws, actionDeps, preserveCurrentPathAfterRename, reload]);

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
  const rawHearingEvents = useHearing(ws.spec.root, compileResult.errors);
  // DP-curation: the DesignPartner's filtering eye sits between raw sensory
  // streams and the User's UI. The Spellbook holds the rules; useDPCurated
  // applies them per-item. Items with no matching Spell pass through.
  const spellbook = useSpellbook(ws.spec.rootPath);
  const hearingEvents = useDPCurated(rawHearingEvents, spellbook, "hearing");

  // Continuous attention — the DP wakes at a regular tempo (substrate only;
  // phenomenologically he attends continuously). Only active for local tiers.
  const experience = useExperience();
  const [chipObservation, setChipObservation] = useState<Observation | null>(null);
  const nextObservationIdRef = useRef(1);
  useFrameTick({
    root: ws.spec.root,
    hearingEvents,
    compileErrors: compileResult.errors,
    activeProvider: selectedProvider(appState.settings) ?? null,
    fallbackProvider: fallbackProvider(appState.settings) ?? null,
    onObservation: (text, exploration) => {
      experience.recordObservation(text, exploration);
      setChipObservation({
        id: nextObservationIdRef.current++,
        text,
        exploration,
      });
    },
  });

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
      <div className={styles.panes}>
      <OntologyPanel />
      <div className={styles.center}>
        <Breadcrumb
          crumbs={breadcrumbs}
          onNavigate={(path) => navigate(path)}
        />
        <ConflictBanner />
        <ConflictToast />
        <EditorToolbar />
        {(() => {
          const sigilEditor = (
            <SigilEditor
              sigil={currentFolder}
              content={content}
              onChange={handleContentChange}
              scope={scope}
              scopeNames={scopeNames}
              scopeRoot={scopeRoot}
              scopePath={scopePath}
              workspaceRoot={ws.spec.root}
              importedOntologies={ws.spec.importedOntologies ?? null}
              coreRefs={coreRefs}
              keybindings={appState.settings.keybindings as unknown as Record<string, string>}
              actionDeps={actionDeps}
              refreshSerial={refreshSerial}
              onCreateSigil={handleCreateSigil}
              onCreateAffordance={handleCreateAffordance}
              onCreateInvariant={handleCreateInvariant}
              onRenameSigil={handleRenameSigil}
              onRenameProperty={handleRenameProperty}
              onRenameStatus={handleRenameStatus}
              onUndoLastRename={handleUndoLastRename}
              onNavigateToSigil={handleNavigateToSigil}
              onNavigateToAbsPath={(path) => {
                // The editor resolves refs against its local scopeRoot, which
                // is the imported-ontologies subtree when the user is inside
                // a library. Paths returned from that resolution are local to
                // that subtree — add the "Imported Ontologies" prefix to put
                // them in the workspace's absolute-path convention. Without
                // this, clicking a @ref inside a library falls through to the
                // main spec tree and resolves to root.
                const inImported = isImportedPath(ws);
                const alreadyPrefixed = path[0] === "Imported Ontologies";
                navigate(inImported && !alreadyPrefixed ? ["Imported Ontologies", ...path] : path);
              }}
              findReferencesTarget={findReferencesTarget}
              onFindReferencesClear={() => { setFindReferencesTarget(null); }}
              goToLine={ws.targetLine}
              onGoToLineDone={() => wsDispatch({ type: "CLEAR_TARGET_LINE" })}
            />
          );
          if (layout.contentTab === "atlas") return <Atlas />;
          if (layout.contentTab === "space") return <SpatialDesktop />;
          if (layout.contentTab === "flowing") {
            return <FlowingSplit left={sigilEditor} right={<SpatialDesktop />} />;
          }
          return sigilEditor;
        })()}
        <ConflictStatusBar />
        <CompileStatusBar result={compileResult} onNavigateToError={(err: RefError) => {
          layoutDispatch({ type: "SET_CONTENT_TAB", tab: "language" });
          navigate(err.path, err.file === "language.md" ? err.line : undefined);
        }} />
        <HearingStatusBar events={hearingEvents} onNavigateToEvent={(e: HearingEvent) => {
          layoutDispatch({ type: "SET_CONTENT_TAB", tab: "language" });
          navigate(e.path);
        }} />
      </div>
      <DesignPartnerPanel />
      </div>
      <GlobalStatusBar />

      <ObservationChip
        observation={chipObservation}
        onDismiss={() => setChipObservation(null)}
      />

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
