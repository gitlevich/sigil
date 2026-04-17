/**
 * ProposeDeleteModal — delete with preview-before-confirmation.
 *
 * Delete is destructive. Before approving, the user sees:
 *   - descendants that would be removed along with the target
 *   - references elsewhere that would be left dangling
 *
 * On Approve, the existing deleteSigil action runs atomically and
 * produces a #confirmation receipt.
 */
import { useEffect, useState } from "react";
import { api, type DeletePreview } from "../../tauri";
import * as actions from "../../actions/workspace";
import { useActionDeps } from "../../hooks/useActionDeps";
import styles from "./ProposeReshapeModal.module.css";

interface ProposeDeleteModalProps {
  targetPath: string;
  targetName: string;
  onClose: () => void;
}

export function ProposeDeleteModal({ targetPath, targetName, onClose }: ProposeDeleteModalProps) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const deps = useActionDeps();

  useEffect(() => {
    let alive = true;
    api.previewDeleteSigil(deps.rootPath, targetPath)
      .then((p) => { if (alive) { setPreview(p); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [deps.rootPath, targetPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function approve() {
    setCommitting(true);
    try {
      await actions.deleteSigil(targetPath, deps);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Propose reshape: delete @{targetName}</h2>
        <p className={styles.hint}>
          Delete is atomic and final. Review what would be removed and what would be left dangling before approving.
        </p>

        {loading && <div className={styles.hint}>Previewing…</div>}
        {error && <div className={styles.error}>{error}</div>}

        {preview && (
          <div className={styles.preview}>
            <div className={styles.summary}>
              @{preview.targetName} would be removed
              {preview.descendants.length > 0
                ? `, along with ${preview.descendants.length} descendant${preview.descendants.length !== 1 ? "s" : ""}`
                : ""}.{" "}
              {preview.danglingReferences.length} reference{preview.danglingReferences.length !== 1 ? "s" : ""}{" "}
              would be left dangling elsewhere.
            </div>

            {preview.descendants.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Descendants removed</h3>
                {preview.descendants.map((d, i) => (
                  <div key={i} className={styles.dirRow}>
                    <span className={styles.from}>@{d}</span>
                  </div>
                ))}
              </div>
            )}

            {preview.danglingReferences.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>References that would dangle</h3>
                {preview.danglingReferences.map((r, i) => (
                  <div key={i} className={styles.lineRow}>
                    <div className={styles.lineNum}>{r.lineNumber}</div>
                    <div className={styles.lines}>
                      <div className={styles.filePath}>{r.filePath}</div>
                      <div className={styles.before}>{r.lineText}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.abandon} onClick={onClose} disabled={committing}>
                Abandon
              </button>
              <button className={styles.approve} onClick={approve} disabled={committing}>
                {committing ? "Deleting…" : "Approve delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
