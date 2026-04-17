import { useCallback, useState } from "react";
import { useWorkspaceState, useWorkspaceDispatch, scopeInfo, isImportedPath } from "../../state/WorkspaceContext";
import { resumeAutoSaveFor, setBase } from "../../hooks/useAutoSave";
import { api, type SigilFolder } from "../../tauri";
import { findContext, type Sigil } from "sigil-core";
import { ThreeWayMergeView } from "./ThreeWayMergeView";
import styles from "./ConflictBanner.module.css";

export function ConflictBanner() {
  const ws = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const { conflict, mergeViewOpen } = ws;

  const [mergedText, setMergedText] = useState<string>("");
  const [hasConflicts, setHasConflicts] = useState<boolean>(true);

  const onContentChange = useCallback((text: string, conflicts: boolean) => {
    setMergedText(text);
    setHasConflicts(conflicts);
  }, []);

  const commitResolved = useCallback(async (text: string) => {
    if (!conflict) return;
    // Auto-save is paused for this file; safe to write merged content directly.
    // Update base to merged BEFORE the write hits so the watcher's echo won't treat it as external.
    setBase(conflict.path, text);
    try {
      await api.writeFile(conflict.path, text);
    } catch (err) {
      console.error("Merge save failed:", err);
      return;
    }
    // Push merged into the workspace spec so LanguageEditor re-picks it up.
    // Temporarily set base to the editor's current doc content so the clean-adopt
    // path in LanguageEditor replaces its doc with the new content.
    const { scopeRoot, scopePath } = scopeInfo(ws);
    const folder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;
    if (folder) {
      setBase(conflict.path, folder.language); // trick: match current CodeMirror doc so effect fires
      const updatedRoot = updateFolderLanguage(ws.spec.root, scopePath, text, isImportedPath(ws));
      const updatedImported = isImportedPath(ws) && ws.spec.importedOntologies
        ? updateFolderLanguage(ws.spec.importedOntologies, scopePath, text, false)
        : ws.spec.importedOntologies;
      dispatch({
        type: "UPDATE_SPEC",
        spec: { ...ws.spec, root: updatedRoot, importedOntologies: updatedImported ?? undefined },
      });
    }
    dispatch({ type: "RESOLVE_CONFLICT" });
    // Defer resume to next tick so LanguageEditor's clean-adopt effect has landed
    // before auto-save is eligible to write again. Prevents a stale-buffer race.
    setTimeout(() => resumeAutoSaveFor(conflict.path), 0);
  }, [conflict, dispatch, ws]);

  const handleResolved = useCallback(() => {
    if (!conflict || hasConflicts) return;
    commitResolved(mergedText);
  }, [conflict, hasConflicts, mergedText, commitResolved]);

  const handleTakeAllMine = useCallback(() => {
    if (!conflict) return;
    commitResolved(conflict.localContent);
  }, [conflict, commitResolved]);

  const handleTakeAllTheirs = useCallback(() => {
    if (!conflict) return;
    commitResolved(conflict.diskContent);
  }, [conflict, commitResolved]);

  const handleDismiss = useCallback(() => {
    dispatch({ type: "CLOSE_MERGE_VIEW" });
  }, [dispatch]);

  const handleKeepEditing = useCallback(() => {
    if (!conflict) return;
    resumeAutoSaveFor(conflict.path);
    dispatch({ type: "RESOLVE_CONFLICT" });
  }, [conflict, dispatch]);

  if (!conflict || !mergeViewOpen) return null;

  if (conflict.deleted) {
    return (
      <div className={styles.banner}>
        <div className={styles.header}>
          <span className={styles.message}>This file was deleted externally.</span>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={handleDismiss}>Later</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleKeepEditing}>Keep editing</button>
          </div>
        </div>
      </div>
    );
  }

  const fileName = conflict.path.split("/").slice(-2).join("/");

  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <span className={styles.message}>
          {fileName} — {hasConflicts ? "resolve remaining conflicts" : "ready to save"}
        </span>
        <div className={styles.actions}>
          <button className={styles.btn} onClick={handleTakeAllMine} title="Discard external, keep my version">Take all mine</button>
          <button className={styles.btn} onClick={handleTakeAllTheirs} title="Discard my edits, take external">Take all theirs</button>
          <button className={styles.btn} onClick={handleDismiss}>Later</button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={hasConflicts}
            onClick={handleResolved}
            title={hasConflicts ? "Resolve all conflicts first" : "Save merged content"}
          >
            Save
          </button>
        </div>
      </div>
      <ThreeWayMergeView
        base={conflict.base}
        mine={conflict.localContent}
        theirs={conflict.diskContent}
        onContentChange={onContentChange}
      />
    </div>
  );
}

function updateFolderLanguage(root: SigilFolder, path: string[], language: string, _isImported: boolean): SigilFolder {
  if (path.length === 0) return { ...root, language };
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child: SigilFolder) =>
      child.name === head ? updateFolderLanguage(child, rest, language, false) : child
    ),
  };
}
