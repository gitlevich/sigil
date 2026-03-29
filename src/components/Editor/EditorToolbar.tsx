import { useAppDispatch, useDocument } from "../../state/AppContext";
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

export function EditorToolbar() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  if (!doc) return null;

  const contentTab = doc.contentTab || "language";

  const setTab = (tab: "language" | "entanglements") => {
    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { contentTab: tab, showTechnical: false },
    });
  };

  const setMode = (mode: "edit" | "split" | "preview") => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { editorMode: mode } });
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.contentTabs}>
        <button
          className={`${styles.contentTab} ${contentTab === "language" ? styles.contentTabActive : ""}`}
          onClick={() => setTab("language")}
          title="Domain language for this bounded context"
        >
          Language
        </button>
        <button
          className={`${styles.contentTab} ${contentTab === "entanglements" ? styles.contentTabActive : ""}`}
          onClick={() => setTab("entanglements")}
          title="Bounded context integration map — drag between contexts to declare relationships"
        >
          Entanglements
        </button>
      </div>

      {contentTab !== "entanglements" && (
        <div className={styles.viewModes}>
          <button
            className={`${styles.modeBtn} ${doc.editorMode === "edit" ? styles.active : ""}`}
            onClick={() => setMode("edit")}
            title="Markup source"
          >
            <MarkupIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${doc.editorMode === "split" ? styles.active : ""}`}
            onClick={() => setMode("split")}
            title="Side-by-side markup and preview"
          >
            <SplitIcon />
          </button>
          <button
            className={`${styles.modeBtn} ${doc.editorMode === "preview" ? styles.active : ""}`}
            onClick={() => setMode("preview")}
            title="Rendered preview"
          >
            <PreviewIcon />
          </button>
        </div>
      )}
    </div>
  );
}
