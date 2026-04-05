import { useState, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { ChatPanel } from "./ChatPanel";
import { MemoriesPanel } from "./MemoriesPanel";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./DesignPartnerPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;

export function DesignPartnerPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const committedWidth = state.ui.rightPanelWidth;
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
        dispatch({ type: "SET_UI", ui: { rightPanelWidth: prev } });
      }
      return null;
    });
  }, [dispatch]);

  if (!doc) return null;

  if (!doc.rightPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() =>
          dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: true } })
        }
      >
        <span className={styles.collapseIcon}>&lsaquo;</span>
      </div>
    );
  }

  const tab = doc.rightPanelTab ?? "chat";

  return (
    <>
      <ResizeHandle side="left" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "chat" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelTab: "chat" } })
              }
            >
              Chat
            </button>
            <button
              className={`${styles.tab} ${tab === "memories" ? styles.active : ""}`}
              onClick={() =>
                dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelTab: "memories" } })
              }
            >
              Memories
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: false } })
            }
          >
            &rsaquo;
          </button>
        </div>
        <div className={styles.content}>
          {tab === "chat" && <ChatPanel />}
          {tab === "memories" && <MemoriesPanel />}
        </div>
      </div>
    </>
  );
}
