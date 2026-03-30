import { useState, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { VisionEditor } from "./VisionEditor";
import { TreeView } from "./TreeView";
import { GlossaryEditor } from "./GlossaryEditor";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./LeftPanel.module.css";

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

export function LeftPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const committedWidth = state.ui.leftPanelWidth;
  const width = dragWidth ?? committedWidth;

  const handleResize = useCallback((delta: number) => {
    setDragWidth((prev) => {
      const base = prev ?? committedWidth;
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, base + delta));
    });
  }, [committedWidth]);

  const handleResizeEnd = useCallback(() => {
    setDragWidth((prev) => {
      if (prev !== null) {
        dispatch({ type: "SET_UI", ui: { leftPanelWidth: prev } });
      }
      return null;
    });
  }, [dispatch]);

  if (!doc) return null;

  if (!doc.leftPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() =>
          dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelOpen: true } })
        }
      >
        <span className={styles.collapseIcon}>&rsaquo;</span>
      </div>
    );
  }

  return (
    <>
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${doc.leftPanelTab === "vision" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "vision" } })
              }
            >
              Vision
            </button>
            <button
              className={`${styles.tab} ${doc.leftPanelTab === "tree" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "tree" } })
              }
            >
              Tree
            </button>
            <button
              className={`${styles.tab} ${doc.leftPanelTab === "glossary" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "glossary" } })
              }
            >
              Glossary
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelOpen: false } })
            }
          >
            &lsaquo;
          </button>
        </div>

        <div className={styles.content}>
          {doc.leftPanelTab === "vision" && <VisionEditor />}
          {doc.leftPanelTab === "tree" && <TreeView />}
          {doc.leftPanelTab === "glossary" && <GlossaryEditor />}
        </div>
      </div>
      <ResizeHandle side="right" onResize={handleResize} onResizeEnd={handleResizeEnd} />
    </>
  );
}
