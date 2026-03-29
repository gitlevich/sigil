import { useState, useEffect, useRef } from "react";
import { Context, api } from "../../tauri";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { useSigil } from "../../hooks/useSigil";
import styles from "./TreeView.module.css";

interface ContextMenuState {
  x: number;
  y: number;
  context: Context;
  path: string[];
}

interface TreeNodeProps {
  context: Context;
  path: string[];
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  onContextMenu: (e: React.MouseEvent, context: Context, path: string[]) => void;
}

function TreeNode({ context, path, currentPath, onNavigate, onContextMenu }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isActive = JSON.stringify(path) === JSON.stringify(currentPath);
  const hasChildren = context.children.length > 0;

  return (
    <div className={styles.node}>
      <div
        className={`${styles.nodeRow} ${isActive ? styles.active : ""}`}
        onClick={() => onNavigate(path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, context, path);
        }}
      >
        {hasChildren && (
          <button
            className={styles.expandBtn}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "\u25BE" : "\u25B8"}
          </button>
        )}
        {!hasChildren && <span className={styles.expandPlaceholder} />}
        <span className={styles.nodeName}>{context.name}</span>
      </div>
      {expanded && hasChildren && (
        <div className={styles.children}>
          {context.children.map((child) => (
            <TreeNode
              key={child.name}
              context={child}
              path={[...path, child.name]}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { reload } = useSigil();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string[]; name: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  if (!doc) return null;

  const handleNavigate = (path: string[]) => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } });
  };

  const handleContextMenu = (e: React.MouseEvent, context: Context, path: string[]) => {
    setContextMenu({ x: e.clientX, y: e.clientY, context, path });
  };

  const handleRename = async (oldPath: string, oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setRenaming(null);
      return;
    }
    try {
      await api.renameContext(oldPath, trimmed);
      await reload(doc.sigil.root_path);
      setRenaming(null);
    } catch (err) {
      console.error("Rename failed:", err);
      setRenaming(null);
    }
  };

  const handleDelete = async (context: Context) => {
    if (!confirm(`Delete "${context.name}" and all its contents? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteContext(context.path);
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  return (
    <div className={styles.tree}>
      <TreeNode
        context={doc.sigil.root}
        path={[]}
        currentPath={doc.currentPath}
        onNavigate={handleNavigate}
        onContextMenu={handleContextMenu}
      />

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={styles.menuItem}
            onClick={() => {
              setRenaming({
                path: contextMenu.path,
                name: contextMenu.context.name,
              });
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          {contextMenu.path.length > 0 && (
            <button
              className={styles.menuItemDanger}
              onClick={() => {
                handleDelete(contextMenu.context);
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {renaming && (
        <div className={styles.renameOverlay}>
          <div className={styles.renameDialog}>
            <label className={styles.renameLabel}>Rename to:</label>
            <input
              ref={renameInputRef}
              className={styles.renameInput}
              defaultValue={renaming.name}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const ctx = findContextByPath(doc.sigil.root, renaming.path);
                  if (ctx) handleRename(ctx.path, renaming.name, e.currentTarget.value);
                }
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={(e) => {
                const ctx = findContextByPath(doc.sigil.root, renaming.path);
                if (ctx) handleRename(ctx.path, renaming.name, e.currentTarget.value);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function findContextByPath(root: Context, path: string[]): Context | null {
  let current = root;
  for (const seg of path) {
    const child = current.children.find((c) => c.name === seg);
    if (!child) return null;
    current = child;
  }
  return current;
}
