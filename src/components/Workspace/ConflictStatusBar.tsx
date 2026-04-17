import { useEffect, useState, useCallback } from "react";
import { useWorkspaceState, useWorkspaceDispatch } from "../../state/WorkspaceContext";
import styles from "./ConflictStatusBar.module.css";

const HIGHLIGHT_MS = 1200;

export function ConflictStatusBar() {
  const ws = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const [justArrived, setJustArrived] = useState(false);

  const conflictPath = ws.conflict?.path ?? null;
  useEffect(() => {
    if (!conflictPath) {
      setJustArrived(false);
      return;
    }
    setJustArrived(true);
    const handle = setTimeout(() => setJustArrived(false), HIGHLIGHT_MS);
    return () => clearTimeout(handle);
  }, [conflictPath]);

  const handleClick = useCallback(() => {
    dispatch({ type: "OPEN_MERGE_VIEW" });
  }, [dispatch]);

  if (!ws.conflict) return null;

  const { path, mergedCount, conflictCount, deleted } = ws.conflict;
  const fileName = path.split("/").slice(-2).join("/");

  return (
    <div
      className={`${styles.bar} ${justArrived ? styles["just-arrived"] : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <span className={styles.dot} />
      <span className={styles.file}>{fileName}</span>
      <span className={styles.sep}>·</span>
      {deleted ? (
        <span className={styles.conflicts}>deleted on disk</span>
      ) : (
        <>
          <span className={styles.merged}>{mergedCount} merged</span>
          <span className={styles.sep}>·</span>
          <span className={styles.conflicts}>{conflictCount} to resolve</span>
        </>
      )}
      <span className={styles.cta}>reconcile</span>
    </div>
  );
}
