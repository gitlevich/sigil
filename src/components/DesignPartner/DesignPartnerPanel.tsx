import { useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import { useLayoutState, useLayoutDispatch } from "../../state/LayoutContext";
import { ChatPanel } from "./ChatPanel";
import { MemoriesPanel } from "./MemoriesPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./DesignPartnerPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;

export function DesignPartnerPanel() {
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const layout = useLayoutState();
  const layoutDispatch = useLayoutDispatch();
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

  if (!layout.designPartnerPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() => layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true })}
      >
        <span className={styles.collapseIcon}>&lsaquo;</span>
      </div>
    );
  }

  const tab = layout.designPartnerPanelTab;

  return (
    <>
      <ResizeHandle side="left" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "chat" ? styles.active : ""}`}
              onClick={() => layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "chat" })}
            >
              Chat
            </button>
            <button
              className={`${styles.tab} ${tab === "memories" ? styles.active : ""}`}
              onClick={() => layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "memories" })}
            >
              Memories
            </button>
            <button
              className={`${styles.tab} ${tab === "experience" ? styles.active : ""}`}
              onClick={() => layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: true, tab: "experience" })}
            >
              Experience
            </button>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() => layoutDispatch({ type: "SET_DESIGN_PARTNER_PANEL", open: false })}
          >
            &rsaquo;
          </button>
        </div>
        <div className={styles.content}>
          {tab === "chat" && <ChatPanel />}
          {tab === "memories" && <MemoriesPanel />}
          {tab === "experience" && <ExperiencePanel />}
        </div>
      </div>
    </>
  );
}
