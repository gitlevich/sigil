import { useState, useMemo, useCallback } from "react";
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext, buildLexicalScope, buildPath } from "./utils";
import { TreeView } from "./TreeView";
import { Breadcrumb } from "./Breadcrumb";
import { Atlas } from "./Atlas";
import { MarkdownPreview } from "./MarkdownPreview";
import "./viewer.css";
import styles from "./MobileViewer.module.css";

type Panel = "none" | "tree" | "affordances" | "invariants";

function PropertyList({
  items,
  refPrefix,
  color,
}: {
  items: { name: string; content: string }[];
  refPrefix: string;
  color: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <div className={styles.propertyList}>
      {items.map((item) => {
        const isOpen = expanded.has(item.name);
        return (
          <div key={item.name} className={styles.propertyItem}>
            <button
              className={styles.propertyHeader}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.name)) next.delete(item.name);
                  else next.add(item.name);
                  return next;
                })
              }
            >
              <span className={styles.propertyToggle}>
                {isOpen ? "\u25BC" : "\u25B6"}
              </span>
              <span style={{ color }}>{refPrefix}{item.name}</span>
            </button>
            {isOpen && item.content && (
              <div className={styles.propertyContent}>{item.content}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}


export function MobileViewer() {
  const { sigil, currentPath, contentTab, theme } = useViewerState();
  const dispatch = useViewerDispatch();
  const [panel, setPanel] = useState<Panel>("none");

  const currentCtx = findContext(sigil.root, currentPath);

  const refs = useMemo(
    () => buildLexicalScope(sigil.root, currentPath),
    [sigil.root, currentPath],
  );

  const handleRefNavigate = useCallback(
    (name: string) => {
      const contained = currentCtx.children.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (contained) {
        dispatch({ type: "NAVIGATE", path: [...currentPath, contained.name] });
        return;
      }
      const path = buildPath(sigil.root, name, []);
      if (path) dispatch({ type: "NAVIGATE", path });
    },
    [sigil.root, currentPath, currentCtx.children, dispatch],
  );

  const handleTreeNavigate = useCallback(() => {
    setPanel("none");
  }, []);

  const affordanceCount = currentCtx.affordances.length;
  const invariantCount = currentCtx.invariants.length;

  return (
    <div className={`sigil-viewer ${styles.layout}`} data-theme={theme}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <Breadcrumb />
        <button
          className={styles.themeBtn}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            localStorage.setItem("sigil-viewer-theme", next);
            dispatch({ type: "SET_THEME", theme: next });
          }}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="3.5" />
              <line x1="8" y1="1" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="15" />
              <line x1="1" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="15" y2="8" />
              <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" /><line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
              <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" /><line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M13.5 9.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Main content area */}
      <div className={styles.contentArea}>
        {/* Editor content */}
        <div
          className={styles.editorPane}
          style={{ display: panel === "none" ? "flex" : "none" }}
        >
          {contentTab === "atlas" ? (
            <div className={styles.atlasContainer}>
              <Atlas />
            </div>
          ) : (
            <div className={styles.editorScroll}>
              <MarkdownPreview
                content={currentCtx.domain_language}
                refs={refs}
                onNavigate={handleRefNavigate}
              />
            </div>
          )}
        </div>

        {/* Tree panel */}
        {panel === "tree" && (
          <div className={styles.slidePanel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Tree</span>
              <button
                className={styles.panelClose}
                onClick={() => setPanel("none")}
              >
                Done
              </button>
            </div>
            <div className={styles.panelScroll}>
              <TreeView onNavigate={handleTreeNavigate} />
            </div>
          </div>
        )}

        {/* Affordances panel */}
        {panel === "affordances" && (
          <div className={styles.slidePanel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Affordances</span>
              <button
                className={styles.panelClose}
                onClick={() => setPanel("none")}
              >
                Done
              </button>
            </div>
            <div className={styles.panelScroll}>
              {affordanceCount > 0 ? (
                <PropertyList
                  items={currentCtx.affordances}
                  refPrefix="#"
                  color="#3d9e8c"
                />
              ) : (
                <div className={styles.emptyPanel}>No affordances</div>
              )}
            </div>
          </div>
        )}

        {/* Invariants panel */}
        {panel === "invariants" && (
          <div className={styles.slidePanel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Invariants</span>
              <button
                className={styles.panelClose}
                onClick={() => setPanel("none")}
              >
                Done
              </button>
            </div>
            <div className={styles.panelScroll}>
              {invariantCount > 0 ? (
                <PropertyList
                  items={currentCtx.invariants}
                  refPrefix="!"
                  color="#e8a040"
                />
              ) : (
                <div className={styles.emptyPanel}>No invariants</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className={styles.bottomBar}>
        <button
          className={`${styles.barBtn} ${panel === "tree" ? styles.barBtnActive : ""}`}
          onClick={() => setPanel(panel === "tree" ? "none" : "tree")}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h8M2 12h10" />
          </svg>
          <span>Tree</span>
        </button>

        <div className={styles.tabGroup}>
          <button
            className={`${styles.tabBtn} ${contentTab === "language" ? styles.tabActive : ""}`}
            onClick={() => { dispatch({ type: "SET_TAB", tab: "language" }); setPanel("none"); }}
            title="Language"
          >
            {/* Document/viewer icon */}
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2" y="1" width="12" height="14" rx="1" />
              <line x1="5" y1="5" x2="11" y2="5" />
              <line x1="5" y1="8" x2="11" y2="8" />
              <line x1="5" y1="11" x2="9" y2="11" />
            </svg>
          </button>
          <button
            className={`${styles.tabBtn} ${contentTab === "atlas" ? styles.tabActive : ""}`}
            onClick={() => { dispatch({ type: "SET_TAB", tab: "atlas" }); setPanel("none"); }}
            title="Atlas"
          >
            {/* Treemap/grid icon */}
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1" y="1" width="14" height="14" rx="1" />
              <line x1="8" y1="1" x2="8" y2="9" />
              <line x1="1" y1="9" x2="15" y2="9" />
              <line x1="5" y1="9" x2="5" y2="15" />
              <line x1="10" y1="9" x2="10" y2="15" />
            </svg>
          </button>
        </div>

        <div className={styles.tabGroup}>
          {affordanceCount > 0 && (
            <button
              className={`${styles.tabBtn} ${panel === "affordances" ? styles.tabActive : ""}`}
              onClick={() => setPanel(panel === "affordances" ? "none" : "affordances")}
              title="Affordances"
            >
              {/* Door handle icon — affordance */}
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="#3d9e8c" strokeWidth="1.2">
                <rect x="2" y="2" width="4" height="10" rx="1" />
                <path d="M6 7L11 7L12 9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
            </button>
          )}
          {invariantCount > 0 && (
            <button
              className={`${styles.tabBtn} ${panel === "invariants" ? styles.tabActive : ""}`}
              onClick={() => setPanel(panel === "invariants" ? "none" : "invariants")}
              title="Invariants"
            >
              {/* Pin/constraint icon — invariant */}
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="#e8a040" strokeWidth="1.5" strokeLinecap="round">
                <line x1="7" y1="1" x2="7" y2="12" />
                <circle cx="7" cy="4.5" r="2" fill="#e8a040" stroke="none" />
              </svg>
            </button>
          )}
        </div>

        <a
          href="#"
          className={styles.barBtn}
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = "";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }}
          title="sigilengineering.com"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
            <path d="M6 14V9h4v5" />
          </svg>
        </a>
      </div>
    </div>
  );
}
