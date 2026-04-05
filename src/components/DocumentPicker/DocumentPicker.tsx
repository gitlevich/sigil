import { useEffect, useState } from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { api, RecentDocument } from "../../tauri";
import { useSigil } from "../../hooks/useSigil";
import { useAppDispatch } from "../../state/AppContext";
import styles from "./DocumentPicker.module.css";

export function DocumentPicker() {
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const { openDocument } = useSigil();
  const dispatch = useAppDispatch();

  useEffect(() => {
    api.listRecentDocuments().then(setRecentDocs).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const selected = await open({ directory: true, title: "Choose location for new sigil" });
    if (!selected) return;

    const rootPath = `${selected}/${newName.trim()}`;
    await api.scaffoldSigil(rootPath);
    // Open in the current window (this is the picker window)
    try {
      await openDocument(rootPath);
    } catch (err) {
      await message(String(err), { title: "Cannot open workspace", kind: "error" });
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
      await openDocument(selected as string);
    } catch (err) {
      await message(String(err), { title: "Cannot open workspace", kind: "error" });
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      await openDocument(path);
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
              placeholder="Sigil name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreating(false); }
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
