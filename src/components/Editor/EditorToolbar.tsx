import { useAppDispatch, useDocument } from "../../state/AppContext";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../../tauri";
import styles from "./EditorToolbar.module.css";

export function EditorToolbar() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  if (!doc) return null;

  const setMode = (mode: "edit" | "split" | "preview") => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { editorMode: mode } });
  };

  const toggleTechnical = () => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { showTechnical: !doc.showTechnical } });
  };

  const handleExport = async () => {
    const outputPath = await save({
      title: "Export sigil",
      defaultPath: `${doc.sigil.name}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!outputPath) return;
    try {
      await api.exportSigil(doc.sigil.root_path, outputPath);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.viewModes}>
        <button
          className={`${styles.modeBtn} ${doc.editorMode === "edit" ? styles.active : ""}`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        <button
          className={`${styles.modeBtn} ${doc.editorMode === "split" ? styles.active : ""}`}
          onClick={() => setMode("split")}
        >
          Split
        </button>
        <button
          className={`${styles.modeBtn} ${doc.editorMode === "preview" ? styles.active : ""}`}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>

      <div className={styles.actions}>
        <button
          className={`${styles.toggleBtn} ${doc.showTechnical ? styles.active : ""}`}
          onClick={toggleTechnical}
        >
          {doc.showTechnical ? "Domain Language" : "Technical"}
        </button>

        <button className={styles.exportBtn} onClick={handleExport}>
          Export
        </button>
      </div>
    </div>
  );
}
