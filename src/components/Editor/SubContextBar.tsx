import { useState, useRef, useEffect } from "react";
import { Context, api } from "../../tauri";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { useSigil } from "../../hooks/useSigil";
import styles from "./SubContextBar.module.css";

interface SubContextBarProps {
  context: Context;
}

export function SubContextBar({ context }: SubContextBarProps) {
  const [renamingChild, setRenamingChild] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; childName: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();
  const { reload } = useSigil();
  const doc = useDocument();

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

  const handleNavigate = (childName: string) => {
    if (!doc) return;
    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { currentPath: [...doc.currentPath, childName], contentTab: "language" },
    });
  };

  const handleRename = async (oldName: string) => {
    if (!doc) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingChild(null);
      return;
    }
    try {
      const childPath = `${context.path}/${oldName}`;
      await api.renameContext(childPath, trimmed);
      await reload(doc.sigil.root_path);
      setRenamingChild(null);
    } catch (err) {
      console.error("Rename failed:", err);
      setRenamingChild(null);
    }
  };

  const handleDelete = async (childName: string) => {
    if (!doc) return;
    const childPath = `${context.path}/${childName}`;
    if (!confirm(`Delete "${childName}" and all its contents? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteContext(childPath);
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Delete failed:", err);
    }
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
            onDoubleClick={() => handleNavigate(child.name)}
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
    </div>
  );
}
