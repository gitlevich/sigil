import { useEffect, useState } from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { api, RecentDocument } from "../../tauri";
import { createNewSigil, chooseNewSigilPath } from "../../actions/newSigil";
import { useAppDispatch } from "../../state/AppContext";
import styles from "./DocumentPicker.module.css";

interface DocumentPickerProps {
  onOpen: (rootPath: string) => Promise<void>;
}

export function DocumentPicker({ onOpen }: DocumentPickerProps) {
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);
  const dispatch = useAppDispatch();

  useEffect(() => {
    api.listRecentDocuments().then(setRecentDocs).catch(console.error);
  }, []);

  const handleCreate = async () => {
    const rootPath = await chooseNewSigilPath();
    if (!rootPath) return;

    try {
      await createNewSigil(rootPath);
      await onOpen(rootPath);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await message(detail, { title: "Cannot create sigil", kind: "error" });
    }
  };

  const handleOpen = async () => {
    const selected = await open({
      directory: false,
      title: "Open Sigil",
      filters: [{ name: "Sigil", extensions: ["sigil"] }],
    });
    if (!selected) return;
    try {
      await onOpen(selected as string);
    } catch (err) {
      await message(String(err), { title: "Cannot open workspace", kind: "error" });
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      await onOpen(path);
    } catch (err) {
      await message(String(err), { title: "Cannot open workspace", kind: "error" });
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <h1 className={styles.title}>Sigil</h1>
        <p className={styles.subtitle}>Structure your thinking. Inhabit it with AI.</p>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={handleCreate}>
          Create New
        </button>

        <button className={styles.actionBtn} onClick={handleOpen}>
          Open Existing
        </button>

        <button
          className={styles.secondaryBtn}
          onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: true })}
        >
          Settings
        </button>
      </div>

      {recentDocs.length > 0 && (
        <div className={styles.recent}>
          <h2 className={styles.recentTitle}>Recent</h2>
          <ul className={styles.recentList}>
            {recentDocs.map((doc) => (
              <li key={doc.path} className={styles.recentItem}>
                <button
                  className={styles.recentBtn}
                  onClick={() => handleOpenRecent(doc.path)}
                >
                  <span className={styles.recentName}>{doc.name}</span>
                  <span className={styles.recentPath}>{doc.path}</span>
                </button>
                <button
                  className={styles.removeBtn}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.removeRecentDocument(doc.path);
                    setRecentDocs((prev) => prev.filter((d) => d.path !== doc.path));
                  }}
                  title="Remove from recent"
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
