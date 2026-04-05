import { useState, useRef, useEffect, useMemo } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { SigilFolder } from "../../tauri";
import {
  useWorkspaceState, useWorkspaceActions,
} from "../../state/WorkspaceContext";
import { useNarratingDispatch } from "../../state/NarratingContext";
import { useToast } from "../../hooks/useToast";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import styles from "./SubContextBar.module.css";

interface SubContextBarProps {
  context: SigilFolder;
}

export function SubContextBar({ context }: SubContextBarProps) {
  const [renamingChild, setRenamingChild] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; childName: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ws = useWorkspaceState();
  const { navigate, reload } = useWorkspaceActions();
  const narratingDispatch = useNarratingDispatch();
  const { addToast } = useToast();

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async () => { await reload(); },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);

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
    navigate([...ws.currentPath, childName]);
    narratingDispatch({ type: "SET_CONTENT_TAB", tab: "language" });
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

  const handleDelete = async (childName: string) => {
    const childPath = `${context.path}/${childName}`;
    if (!await confirm(`Delete "${childName}" and all its contents? This cannot be undone.`)) {
      return;
    }
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
    </div>
  );
}
