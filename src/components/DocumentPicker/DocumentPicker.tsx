import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, RecentDocument } from "../../tauri";
import { useSpecTree } from "../../hooks/useSpecTree";
import { useAppDispatch } from "../../state/AppContext";
import styles from "./DocumentPicker.module.css";

export function DocumentPicker() {
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const { openDocument } = useSpecTree();
  const dispatch = useAppDispatch();

  useEffect(() => {
    api.listRecentDocuments().then(setRecentDocs).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const selected = await open({ directory: true, title: "Choose location for spec tree" });
    if (!selected) return;

    const rootPath = `${selected}/${newName.trim()}`;
    await api.writeFile(`${rootPath}/vision.md`, "");
    await api.writeFile(`${rootPath}/spec.md`, "");
    // Open in the current window (this is the picker window)
    await openDocument(rootPath);
  };

  const handleOpen = async () => {
    const selected = await open({ directory: true, title: "Open spec tree root directory" });
    if (!selected) return;
    // Open in the current window
    await openDocument(selected as string);
  };

  const handleOpenRecent = async (path: string) => {
    try {
      // Open in the current window
      await openDocument(path);
    } catch (err) {
      console.error("Failed to open recent:", err);
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <h1 className={styles.title}>Sigil</h1>
        <p className={styles.subtitle}>Hierarchical Specification Editor</p>
      </div>

      <div className={styles.actions}>
        {!creating ? (
          <button className={styles.actionBtn} onClick={() => setCreating(true)}>
            Create New
          </button>
        ) : (
          <div className={styles.createForm}>
            <input
              className={styles.nameInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Spec tree name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <button className={styles.actionBtn} onClick={handleCreate}>Create</button>
            <button className={styles.secondaryBtn} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        )}

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
