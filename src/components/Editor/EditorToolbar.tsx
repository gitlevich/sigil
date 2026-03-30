import { useAppDispatch, useDocument, useAppState } from "../../state/AppContext";
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

type Facet = "ux" | "language" | "architecture" | "implementation";

export function EditorToolbar() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const state = useAppState();
  if (!doc) return null;

  const contentTab = doc.contentTab || "language";
  const activeFacet: Facet = doc.activeFacet ?? "language";
  const kb = state.settings.keybindings || DEFAULT_KEYBINDINGS;
  const ds = (key: keyof typeof kb) => toDisplayShortcut(kb[key]);

  const FACETS: { key: Facet; label: string; title: string }[] = [
    { key: "ux", label: "UX", title: `User experience (${ds("facet-ux")})` },
    { key: "language", label: "Language", title: `Domain language (${ds("facet-language")})` },
    { key: "architecture", label: "Architecture", title: `Architecture notes (${ds("facet-architecture")})` },
    { key: "implementation", label: "Implementation", title: `Implementation details (${ds("facet-implementation")})` },
  ];

  const setFacet = (facet: Facet) => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { activeFacet: facet, contentTab: "language" } });
  };

  const setMode = (mode: "edit" | "split" | "preview") => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { editorMode: mode } });
  };

  const toggleWrap = () => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { wordWrap: !doc.wordWrap } });
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.contentTabs}>
        {FACETS.map(({ key, label, title }) => (
          <button
            key={key}
            className={`${styles.contentTab} ${contentTab === "language" && activeFacet === key ? styles.contentTabActive : ""}`}
            onClick={() => setFacet(key)}
            title={title}
          >
            {label}
          </button>
        ))}
        <button
          className={`${styles.contentTab} ${contentTab === "map" ? styles.contentTabActive : ""}`}
          onClick={() => dispatch({ type: "UPDATE_DOCUMENT", updates: { contentTab: "map" } })}
          title={`Map — drag between sigils to declare relationships (${ds("facet-map")})`}
        >
          Map
        </button>
      </div>

      {contentTab !== "map" && (
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
          <span className={styles.separator} />
          <button
            className={`${styles.modeBtn} ${doc.wordWrap ? styles.active : ""}`}
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
