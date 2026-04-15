import { useAppState } from "../../state/AppContext";
import { useLayoutState, useLayoutDispatch } from "../../state/LayoutContext";
import { DEFAULT_KEYBINDINGS, toDisplayShortcut } from "../../tauri";
import styles from "./EditorToolbar.module.css";

const MarkupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="3" y1="4" x2="13" y2="4" />
    <line x1="3" y1="8" x2="13" y2="8" />
    <line x1="3" y1="12" x2="10" y2="12" />
  </svg>
);

const SplitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="2" width="5" height="12" rx="1" />
    <rect x="9" y="2" width="5" height="12" rx="1" />
  </svg>
);

const PreviewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 8C2 8 4.5 3.5 8 3.5C11.5 3.5 14 8 14 8C14 8 11.5 12.5 8 12.5C4.5 12.5 2 8 2 8Z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

const WrapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="3" y1="4" x2="13" y2="4" />
    <line x1="3" y1="8" x2="11" y2="8" />
    <path d="M11 8C12.5 8 13 9 13 10C13 11 12.5 12 11 12H7" />
    <polyline points="8.5,10.5 7,12 8.5,13.5" />
  </svg>
);

export function EditorToolbar() {
  const appState = useAppState();
  const layout = useLayoutState();
  const layoutDispatch = useLayoutDispatch();

  const kb = appState.settings.keybindings || DEFAULT_KEYBINDINGS;
  const ds = (key: keyof typeof kb) => toDisplayShortcut(kb[key]);

  const setMode = (mode: "edit" | "split" | "preview") => {
    layoutDispatch({ type: "SET_EDITOR_MODE", mode });
  };

  const toggleWrap = () => {
    layoutDispatch({ type: "SET_WORD_WRAP", wrap: !layout.wordWrap });
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.contentTabs}>
        <button
          className={`${styles.contentTab} ${layout.contentTab === "language" ? styles.contentTabActive : ""}`}
          onClick={() => layoutDispatch({ type: "SET_CONTENT_TAB", tab: "language" })}
          title="Language"
        >
          Language
        </button>
        <button
          className={`${styles.contentTab} ${layout.contentTab === "atlas" ? styles.contentTabActive : ""}`}
          onClick={() => layoutDispatch({ type: "SET_CONTENT_TAB", tab: "atlas" })}
          title={`Atlas — treemap of context structure (${ds("facet-map")})`}
        >
          Atlas
        </button>
        <button
          className={`${styles.contentTab} ${layout.contentTab === "space" ? styles.contentTabActive : ""}`}
          onClick={() => layoutDispatch({ type: "SET_CONTENT_TAB", tab: "space" })}
          title="Space — 3D sigil viewer (Ctrl+7)"
        >
          Space
        </button>
      </div>

      {layout.contentTab === "language" && (
        <div className={styles.viewModes}>
          <button
            className={`${styles.modeBtn} ${layout.editorMode === "edit" ? styles.active : ""}`}
            onClick={() => setMode("edit")}
            title="Markup source"
          >
            <MarkupIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${layout.editorMode === "split" ? styles.active : ""}`}
            onClick={() => setMode("split")}
            title="Side-by-side markup and preview"
          >
            <SplitIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${layout.editorMode === "preview" ? styles.active : ""}`}
            onClick={() => setMode("preview")}
            title="Rendered preview"
          >
            <PreviewIcon />
          </button>
          <span className={styles.separator} />
          <button
            className={`${styles.modeBtn} ${layout.wordWrap ? styles.active : ""}`}
            onClick={toggleWrap}
            title={`Toggle word wrap (${ds("toggle-word-wrap")})`}
          >
            <WrapIcon />
          </button>
        </div>
      )}
    </div>
  );
}
