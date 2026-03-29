import { useState } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { useAutoSave } from "../../hooks/useAutoSave";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import styles from "./VisionEditor.module.css";

export function VisionEditor() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { save } = useAutoSave();
  const [mode, setMode] = useState<"edit" | "preview">("preview");

  if (!doc) return null;

  const handleChange = (value: string) => {
    const path = `${doc.sigil.root_path}/vision.md`;
    save(path, value);
    dispatch({
      type: "UPDATE_SIGIL",
      sigil: { ...doc.sigil, vision: value },
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          className={`${styles.modeBtn} ${mode === "edit" ? styles.active : ""}`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        <button
          className={`${styles.modeBtn} ${mode === "preview" ? styles.active : ""}`}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>

      <div className={styles.content}>
        {mode === "edit" ? (
          <textarea
            className={styles.textarea}
            value={doc.sigil.vision}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Write the vision statement for this application..."
          />
        ) : (
          <div className={styles.previewArea}>
            {doc.sigil.vision ? (
              <MarkdownPreview content={doc.sigil.vision} />
            ) : (
              <p className={styles.placeholder}>
                No vision statement yet. Switch to Edit to write one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
