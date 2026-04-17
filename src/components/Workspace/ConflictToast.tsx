import { useEffect, useState, useCallback } from "react";
import { useWorkspaceState, useWorkspaceDispatch } from "../../state/WorkspaceContext";
import styles from "./ConflictToast.module.css";

const VISIBLE_MS = 4500;

export function ConflictToast() {
  const ws = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const [visible, setVisible] = useState(false);

  // Retrigger visibility when a new conflict appears (path change).
  const conflictPath = ws.conflict?.path ?? null;
  useEffect(() => {
    if (!conflictPath) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const handle = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(handle);
  }, [conflictPath]);

  const handleClick = useCallback(() => {
    dispatch({ type: "OPEN_MERGE_VIEW" });
    setVisible(false);
  }, [dispatch]);

  if (!ws.conflict) return null;

  const { path, mergedCount, conflictCount, deleted } = ws.conflict;
  const fileName = path.split("/").slice(-2).join("/");

  return (
    <div
      className={`${styles.toast} ${visible ? styles.visible : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <span className={styles.file}>{fileName}</span>
      <span className={styles.sep}>•</span>
      {deleted ? (
        <span className={styles.conflicts}>deleted on disk</span>
      ) : (
        <>
          <span className={styles.merged}>{mergedCount} merged</span>
          <span className={styles.sep}>·</span>
          <span className={styles.conflicts}>{conflictCount} to resolve</span>
        </>
      )}
    </div>
  );
}
