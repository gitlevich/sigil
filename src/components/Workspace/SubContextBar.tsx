import { useState, useRef, useEffect } from "react";
import { SigilFolder } from "../../tauri";
import {
  useWorkspaceState, useWorkspaceActions,
} from "../../state/WorkspaceContext";
import { useLayoutDispatch } from "../../state/LayoutContext";
import { useActionDeps } from "../../hooks/useActionDeps";
import * as actions from "../../actions/workspace";
import styles from "./SubContextBar.module.css";

interface SubContextBarProps {
  context: SigilFolder;
}

export function SubContextBar({ context }: SubContextBarProps) {
  const [renamingChild, setRenamingChild] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; childName: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const ws = useWorkspaceState();
  const { navigate } = useWorkspaceActions();
  const layoutDispatch = useLayoutDispatch();

  const actionDeps = useActionDeps();

  useEffect(() => {
    if (renamingChild && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChild]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (deleting && deleteConfirmRef.current) deleteConfirmRef.current.focus();
  }, [deleting]);

  const handleNavigate = (childName: string) => {
    navigate([...ws.currentPath, childName]);
    layoutDispatch({ type: "SET_CONTENT_TAB", tab: "language" });
  };

  const handleRename = async (oldName: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingChild(null);
      return;
    }
    const childPath = `${context.path}/${oldName}`;
    await actions.renameContext(childPath, oldName, trimmed, actionDeps);
    setRenamingChild(null);
  };

  const handleDelete = (childName: string) => {
    setDeleting(childName);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const childPath = `${context.path}/${deleting}`;
    setDeleting(null);
    await actions.deleteSigil(childPath, actionDeps);
  };

  return (
    <div className={styles.bar}>
      {context.children.map((child) => (
        renamingChild === child.name ? (
          <div key={child.name} className={styles.addForm}>
            <input
              ref={renameInputRef}
              className={styles.addInput}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(child.name);
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenamingChild(null); }
              }}
              onBlur={() => handleRename(child.name)}
            />
          </div>
        ) : (
          <div
            key={child.name}
            className={styles.box}
            onClick={() => handleNavigate(child.name)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, childName: child.name });
            }}
          >
            {child.name}
          </div>
        )
      ))}

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={styles.contextMenuItemDefault}
            onClick={() => {
              setRenameValue(contextMenu.childName);
              setRenamingChild(contextMenu.childName);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className={styles.contextMenuItemDanger}
            onClick={() => {
              handleDelete(contextMenu.childName);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {deleting && (
        <div className={styles.deleteOverlay} onClick={() => setDeleting(null)}>
          <div
            className={styles.deleteDialog}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setDeleting(null); }
              if (e.key === "Enter") { e.preventDefault(); confirmDelete(); }
            }}
          >
            <label className={styles.deleteLabel}>
              Delete "{deleting}" and all its contents? This cannot be undone.
            </label>
            <div className={styles.deleteActions}>
              <button className={styles.deleteCancelBtn} onClick={() => setDeleting(null)}>Cancel</button>
              <button ref={deleteConfirmRef} className={styles.deleteConfirmBtn} onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
