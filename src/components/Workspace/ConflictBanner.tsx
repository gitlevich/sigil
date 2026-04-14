import { useEffect, useRef, useCallback } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { useWorkspaceState, useWorkspaceDispatch, FileConflict } from "../../state/WorkspaceContext";
import { resumeAutoSaveFor, setBase } from "../../hooks/useAutoSave";
import styles from "./ConflictBanner.module.css";

function MergePanel({ conflict }: { conflict: FileConflict }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new MergeView({
      a: {
        doc: conflict.diskContent,
        extensions: [
          markdown(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.theme({
            "&": { height: "100%", fontSize: "var(--content-font-size, 14px)" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      },
      b: {
        doc: conflict.localContent,
        extensions: [
          markdown(),
          EditorView.theme({
            "&": { height: "100%", fontSize: "var(--content-font-size, 14px)" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      },
      parent: containerRef.current,
      collapseUnchanged: { margin: 3, minSize: 4 },
      gutter: true,
      highlightChanges: true,
      revertControls: "a-to-b",
    });
    mergeRef.current = view;

    return () => {
      view.destroy();
      mergeRef.current = null;
    };
  }, [conflict.diskContent, conflict.localContent]);

  return <div ref={containerRef} className={styles.mergeContainer} />;
}

export function ConflictBanner() {
  const ws = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const { conflict } = ws;

  const handleResolved = useCallback(() => {
    if (!conflict) return;
    // The user reconciled in the merge view's right pane.
    // Resume auto-save — next edit in the main editor triggers a save.
    resumeAutoSaveFor(conflict.path);
    setBase(conflict.path, conflict.diskContent);
    dispatch({ type: "RESOLVE_CONFLICT" });
  }, [conflict, dispatch]);

  const handleKeepEditing = useCallback(() => {
    if (!conflict) return;
    // File was deleted externally but user wants to keep their work.
    // Resume auto-save — it will recreate the file.
    resumeAutoSaveFor(conflict.path);
    dispatch({ type: "RESOLVE_CONFLICT" });
  }, [conflict, dispatch]);

  if (!conflict) return null;

  if (conflict.deleted) {
    return (
      <div className={styles.banner}>
        <div className={styles.header}>
          <span className={styles.message}>
            This file was deleted externally.
          </span>
          <div className={styles.actions}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleKeepEditing}>
              Keep editing
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <span className={styles.message}>
          This file was changed externally. Reconcile below.
        </span>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleResolved}>
            Resolved
          </button>
        </div>
      </div>
      <div style={{ display: "flex" }}>
        <div className={styles.label} style={{ flex: 1 }}>External (read-only)</div>
        <div className={styles.label} style={{ flex: 1 }}>Yours (editable)</div>
      </div>
      <MergePanel conflict={conflict} />
    </div>
  );
}
