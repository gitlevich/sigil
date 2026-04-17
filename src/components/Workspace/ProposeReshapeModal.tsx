/**
 * ProposeReshapeModal — the UI for Workspace/#propose-reshape.
 *
 * Shows the full blast radius of a rename before the reshape happens,
 * then offers Approve (runs the actual rename atomically via the normal
 * action path, producing a #confirmation receipt) or Abandon (closes
 * without mutating anything).
 *
 * Spec invariants honored: !reshapes-are-atomic, !every-mutation-confirmed.
 */
import { useEffect, useState } from "react";
import { api, type ReshapePreview } from "../../tauri";
import * as actions from "../../actions/workspace";
import { useActionDeps } from "../../hooks/useActionDeps";
import styles from "./ProposeReshapeModal.module.css";

interface ProposeReshapeModalProps {
  /** Filesystem path of the target sigil. */
  targetPath: string;
  /** Current name of the target sigil. */
  oldName: string;
  /** Close without applying. */
  onClose: () => void;
}

export function ProposeReshapeModal({ targetPath, oldName, onClose }: ProposeReshapeModalProps) {
  const [newName, setNewName] = useState(oldName);
  const [preview, setPreview] = useState<ReshapePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const deps = useActionDeps();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function runPreview() {
    if (!newName || newName === oldName) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const p = await api.previewRenameSigil(deps.rootPath, targetPath, newName);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!preview) return;
    setCommitting(true);
    try {
      await actions.renameSigil(targetPath, newName, deps);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  const ready = newName.trim().length > 0 && newName !== oldName;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Propose reshape: rename @{oldName}</h2>
        <p className={styles.hint}>
          The reshape will be previewed first. You approve or abandon after seeing the blast radius.
        </p>

        <div className={styles.nameRow}>
          <label className={styles.label}>New name</label>
          <input
            className={styles.input}
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setPreview(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && ready) runPreview(); }}
            autoFocus
            spellCheck={false}
          />
          <button className={styles.previewButton} onClick={runPreview} disabled={!ready || loading}>
            {loading ? "Previewing..." : preview ? "Re-preview" : "Preview"}
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {preview && (
          <div className={styles.preview}>
            <div className={styles.summary}>
              {preview.fileChanges.length} file{preview.fileChanges.length !== 1 ? "s" : ""} —{" "}
              {preview.totalMatchCount} line{preview.totalMatchCount !== 1 ? "s" : ""} would change.{" "}
              {preview.directoryRenames.length} director{preview.directoryRenames.length !== 1 ? "ies" : "y"} would rename.
            </div>

            {preview.directoryRenames.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Directories</h3>
                {preview.directoryRenames.map((d, i) => (
                  <div key={i} className={styles.dirRow}>
                    <span className={styles.from}>{d.fromPath}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.to}>{d.toPath}</span>
                  </div>
                ))}
              </div>
            )}

            {preview.fileChanges.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Files</h3>
                {preview.fileChanges.map((f, i) => (
                  <div key={i} className={styles.fileRow}>
                    <div className={styles.filePath}>
                      {f.path} <span className={styles.fileCount}>({f.matchCount})</span>
                    </div>
                    {f.sampleLines.map((line, j) => (
                      <div key={j} className={styles.lineRow}>
                        <div className={styles.lineNum}>{line.lineNumber}</div>
                        <div className={styles.lines}>
                          <div className={styles.before}>- {line.before}</div>
                          <div className={styles.after}>+ {line.after}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.abandon} onClick={onClose} disabled={committing}>
                Abandon
              </button>
              <button className={styles.approve} onClick={approve} disabled={committing}>
                {committing ? "Applying..." : "Approve"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
