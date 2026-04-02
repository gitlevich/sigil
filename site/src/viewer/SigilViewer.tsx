import { useMemo, useState, useCallback, useRef } from "react";
import sigilSpec from "../data/sigil-spec.json";
import type { Sigil } from "./types";
import { ViewerProvider, useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext, buildLexicalScope, buildPath } from "./utils";
import { TreeView } from "./TreeView";
import { Breadcrumb } from "./Breadcrumb";
import { Atlas } from "./Atlas";
import { MarkdownPreview } from "./MarkdownPreview";
import { PropertyBar } from "./PropertyBar";
import { SubContextBar } from "./SubContextBar";
import { ThemeToggle } from "./ThemeToggle";
import "./viewer.css";
import styles from "./SigilViewer.module.css";

function VisionPanel({ vision }: { vision: string }) {
  if (!vision) {
    return (
      <div className={styles.visionEmpty}>No vision statement.</div>
    );
  }
  return (
    <div className={styles.visionPanel}>
      <MarkdownPreview content={vision} refs={[]} />
    </div>
  );
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 260;

function ResizeHandle({ onResize, onResizeEnd }: { onResize: (delta: number) => void; onResizeEnd: () => void }) {
  const startXRef = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      startXRef.current = moveEvent.clientX;
      onResizeRef.current(delta);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEndRef.current();
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return <div className={styles.resizeHandle} onMouseDown={handleMouseDown} />;
}

function ViewerContent() {
  const { sigil, currentPath, contentTab, sidebarTab, theme } = useViewerState();
  const dispatch = useViewerDispatch();
  const currentCtx = findContext(sigil.root, currentPath);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const displayWidth = dragWidth ?? sidebarWidth;

  const refs = useMemo(
    () => buildLexicalScope(sigil.root, currentPath),
    [sigil.root, currentPath]
  );

  const handleRefNavigate = useCallback((name: string) => {
    // Check children first
    const contained = currentCtx.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (contained) {
      dispatch({ type: "NAVIGATE", path: [...currentPath, contained.name] });
      return;
    }
    // Search the whole tree
    const path = buildPath(sigil.root, name, []);
    if (path) {
      dispatch({ type: "NAVIGATE", path });
    }
  }, [sigil.root, currentPath, currentCtx.children, dispatch]);

  return (
    <div className={`sigil-viewer ${styles.layout}`} data-theme={theme}>
      <div className={styles.body}>
        {sidebarOpen ? (
          <>
            <aside className={styles.sidebar} style={{ width: displayWidth }}>
              <div className={styles.sidebarTabs}>
                <button
                  className={`${styles.sidebarTabBtn} ${sidebarTab === "vision" ? styles.sidebarTabActive : ""}`}
                  onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", tab: "vision" })}
                >
                  Vision
                </button>
                <button
                  className={`${styles.sidebarTabBtn} ${sidebarTab === "tree" ? styles.sidebarTabActive : ""}`}
                  onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", tab: "tree" })}
                >
                  Tree
                </button>
                <button
                  className={styles.collapseBtn}
                  onClick={() => setSidebarOpen(false)}
                  title="Collapse sidebar"
                >
                  &lsaquo;
                </button>
              </div>
              <div className={styles.sidebarContent}>
                {sidebarTab === "vision" ? (
                  <VisionPanel vision={sigil.vision} />
                ) : (
                  <TreeView />
                )}
              </div>
            </aside>
            <ResizeHandle
              onResize={(delta) => setDragWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (dragWidth ?? sidebarWidth) + delta)))}
              onResizeEnd={() => { setSidebarWidth(dragWidth ?? sidebarWidth); setDragWidth(null); }}
            />
          </>
        ) : (
          <div className={styles.collapsed} onClick={() => setSidebarOpen(true)}>
            <span className={styles.collapseIcon}>&rsaquo;</span>
          </div>
        )}
        <main className={styles.main}>
          <div className={styles.toolbar}>
            <div className={styles.tabSwitch}>
              <button
                className={`${styles.tabBtn} ${contentTab === "language" ? styles.tabActive : ""}`}
                onClick={() => dispatch({ type: "SET_TAB", tab: "language" })}
              >
                Language
              </button>
              <button
                className={`${styles.tabBtn} ${contentTab === "atlas" ? styles.tabActive : ""}`}
                onClick={() => dispatch({ type: "SET_TAB", tab: "atlas" })}
              >
                Atlas
              </button>
            </div>
            <Breadcrumb />
            <div className={styles.toolbarRight}>
              <ThemeToggle />
              <a
                href="#"
                className={styles.backLink}
                onClick={(e) => {
                  e.preventDefault();
                  window.location.hash = "";
                  window.dispatchEvent(new HashChangeEvent("hashchange"));
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M7 1L1 7l6 6M1 7h12" />
                </svg>
                <span>sigilengineering.com</span>
              </a>
            </div>
          </div>
          {contentTab !== "atlas" && (
            <PropertyBar
              title="Affordances"
              refPrefix="#"
              color="#3d9e8c"
              items={currentCtx.affordances}
            />
          )}
          <div className={styles.content}>
            {contentTab === "atlas" ? (
              <Atlas />
            ) : (
              <MarkdownPreview
                content={currentCtx.domain_language}
                refs={refs}
                onNavigate={handleRefNavigate}
              />
            )}
          </div>
          {contentTab !== "atlas" && (
            <PropertyBar
              title="Invariants"
              refPrefix="!"
              color="#e8a040"
              items={currentCtx.invariants}
            />
          )}
          <SubContextBar context={currentCtx} />
        </main>
      </div>
    </div>
  );
}

export function SigilViewer() {
  return (
    <ViewerProvider sigil={sigilSpec as Sigil}>
      <ViewerContent />
    </ViewerProvider>
  );
}
