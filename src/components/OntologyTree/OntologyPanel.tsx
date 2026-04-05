import { useState, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { VisionEditor } from "./VisionEditor";
import { OntologyTree } from "./OntologyTree";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./OntologyPanel.module.css";

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

export function OntologyPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const committedWidth = state.ui.ontologyPanelWidth;
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
        dispatch({ type: "SET_UI", ui: { ontologyPanelWidth: prev } });
      }
      return null;
    });
  }, [dispatch]);

  if (!doc) return null;

  if (!doc.ontologyPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() =>
          dispatch({ type: "UPDATE_DOCUMENT", updates: { ontologyPanelOpen: true } })
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
              className={`${styles.tab} ${doc.ontologyPanelTab === "vision" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { ontologyPanelTab: "vision" } })
              }
            >
              Vision
            </button>
            <button
              className={`${styles.tab} ${doc.ontologyPanelTab === "ontology" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { ontologyPanelTab: "ontology" } })
              }
            >
              Ontology
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { ontologyPanelOpen: false } })
            }
          >
            &lsaquo;
          </button>
        </div>

        <div className={styles.content}>
          {doc.ontologyPanelTab === "vision" && <VisionEditor />}
          {doc.ontologyPanelTab === "ontology" && <OntologyTree />}
        </div>
      </div>
      <ResizeHandle side="right" onResize={handleResize} onResizeEnd={handleResizeEnd} />
    </>
  );
}
