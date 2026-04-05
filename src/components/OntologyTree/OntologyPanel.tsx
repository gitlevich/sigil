import { useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import { useNarratingState, useNarratingDispatch } from "../../state/NarratingContext";
import { VisionEditor } from "./VisionEditor";
import { OntologyTree } from "./OntologyTree";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./OntologyPanel.module.css";

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

export function OntologyPanel() {
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const narrating = useNarratingState();
  const narratingDispatch = useNarratingDispatch();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const committedWidth = appState.ui.ontologyPanelWidth;
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
        appDispatch({ type: "SET_UI", ui: { ontologyPanelWidth: prev } });
      }
      return null;
    });
  }, [appDispatch]);

  if (!narrating.ontologyPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() => narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: true })}
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
              className={`${styles.tab} ${narrating.ontologyPanelTab === "vision" ? styles.active : ""}`}
              onClick={() => narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "vision" })}
            >
              Vision
            </button>
            <button
              className={`${styles.tab} ${narrating.ontologyPanelTab === "ontology" ? styles.active : ""}`}
              onClick={() => narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: true, tab: "ontology" })}
            >
              Ontology
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() => narratingDispatch({ type: "SET_ONTOLOGY_PANEL", open: false })}
          >
            &lsaquo;
          </button>
        </div>

        <div className={styles.content}>
          {narrating.ontologyPanelTab === "vision" && <VisionEditor />}
          {narrating.ontologyPanelTab === "ontology" && <OntologyTree />}
        </div>
      </div>
      <ResizeHandle side="right" onResize={handleResize} onResizeEnd={handleResizeEnd} />
    </>
  );
}
