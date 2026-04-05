import { useAppState } from "../../state/AppContext";
import { useNarratingState, useNarratingDispatch } from "../../state/NarratingContext";
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
  const narrating = useNarratingState();
  const narratingDispatch = useNarratingDispatch();

  const kb = appState.settings.keybindings || DEFAULT_KEYBINDINGS;
  const ds = (key: keyof typeof kb) => toDisplayShortcut(kb[key]);

  const setMode = (mode: "edit" | "split" | "preview") => {
    narratingDispatch({ type: "SET_EDITOR_MODE", mode });
  };

  const toggleWrap = () => {
    narratingDispatch({ type: "SET_WORD_WRAP", wrap: !narrating.wordWrap });
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.contentTabs}>
        <button
          className={`${styles.contentTab} ${narrating.contentTab === "language" ? styles.contentTabActive : ""}`}
          onClick={() => narratingDispatch({ type: "SET_CONTENT_TAB", tab: "language" })}
          title="Language"
        >
          Language
        </button>
        <button
          className={`${styles.contentTab} ${narrating.contentTab === "atlas" ? styles.contentTabActive : ""}`}
          onClick={() => narratingDispatch({ type: "SET_CONTENT_TAB", tab: "atlas" })}
          title={`Atlas — treemap of context structure (${ds("facet-map")})`}
        >
          Atlas
        </button>
      </div>

      {narrating.contentTab !== "atlas" && (
        <div className={styles.viewModes}>
          <button
            className={`${styles.modeBtn} ${narrating.editorMode === "edit" ? styles.active : ""}`}
            onClick={() => setMode("edit")}
            title="Markup source"
          >
            <MarkupIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${narrating.editorMode === "split" ? styles.active : ""}`}
            onClick={() => setMode("split")}
            title="Side-by-side markup and preview"
          >
            <SplitIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${narrating.editorMode === "preview" ? styles.active : ""}`}
            onClick={() => setMode("preview")}
            title="Rendered preview"
          >
            <PreviewIcon />
          </button>
          <span className={styles.separator} />
          <button
            className={`${styles.modeBtn} ${narrating.wordWrap ? styles.active : ""}`}
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
