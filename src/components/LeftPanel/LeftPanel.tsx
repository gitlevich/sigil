import { useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { VisionEditor } from "./VisionEditor";
import { TreeView } from "./TreeView";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./LeftPanel.module.css";

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

export function LeftPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();

  const width = state.ui.leftPanelWidth;

  const handleResize = useCallback((delta: number) => {
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta));
    dispatch({ type: "SET_UI", ui: { leftPanelWidth: newWidth } });
  }, [width, dispatch]);

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
          {doc.leftPanelTab === "vision" ? <VisionEditor /> : <TreeView />}
        </div>
      </div>
      <ResizeHandle side="right" onResize={handleResize} />
    </>
  );
}
