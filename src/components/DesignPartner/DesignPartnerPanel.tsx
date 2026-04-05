import { useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import { useNarratingState, useNarratingDispatch } from "../../state/NarratingContext";
import { ChatPanel } from "./ChatPanel";
import { MemoriesPanel } from "./MemoriesPanel";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./DesignPartnerPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;

export function DesignPartnerPanel() {
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const narrating = useNarratingState();
  const narratingDispatch = useNarratingDispatch();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const committedWidth = appState.ui.designPartnerPanelWidth;
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
        appDispatch({ type: "SET_UI", ui: { designPartnerPanelWidth: prev } });
      }
      return null;
    });
  }, [appDispatch]);

  if (!narrating.designPartnerPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() => narratingDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true })}
      >
        <span className={styles.collapseIcon}>&lsaquo;</span>
      </div>
    );
  }

  const tab = narrating.designPartnerPanelTab;

  return (
    <>
      <ResizeHandle side="left" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "chat" ? styles.active : ""}`}
              onClick={() => narratingDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "chat" })}
            >
              Chat
            </button>
            <button
              className={`${styles.tab} ${tab === "memories" ? styles.active : ""}`}
              onClick={() => narratingDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "memories" })}
            >
              Memories
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() => narratingDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: false })}
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
