import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
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
  highlightedChild: string | null;
  onNavigate: (path: string[]) => void;
  onContextMenu: (e: React.MouseEvent, context: Context, path: string[]) => void;
  onAdd: (parentPath: string) => Promise<void>;
  onDrop: (sourcePath: string, targetPath: string) => void;
}

function TreeNode({ context, path, currentPath, highlightedChild, onNavigate, onContextMenu, onAdd, onDrop }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropTarget, setDropTarget] = useState(false);
  const isActive = JSON.stringify(path) === JSON.stringify(currentPath);
  // Highlighted if this node is the highlightedChild of the active node's parent
  const isHighlighted = !isActive && highlightedChild === context.name
    && JSON.stringify(path.slice(0, -1)) === JSON.stringify(currentPath);
  const hasChildren = context.children.length > 0;
  const atLimit = context.children.length >= 5;

  return (
    <div className={styles.node}>
      <div
        className={`${styles.nodeRow} ${isActive ? styles.active : ""} ${isHighlighted ? styles.highlighted : ""} ${dropTarget ? styles.dropTarget : ""}`}
        onClick={() => onNavigate(path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, context, path);
        }}
        draggable={path.length > 0}
        onDragStart={(e) => {
          e.dataTransfer.setData("sigil-path", context.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(false);
          const sourcePath = e.dataTransfer.getData("sigil-path");
          if (sourcePath && sourcePath !== context.path) {
            onDrop(sourcePath, context.path);
          }
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
      {expanded && (
        <div className={styles.children}>
          {context.children.map((child) => (
            <TreeNode
              key={child.name}
              context={child}
              path={[...path, child.name]}
              currentPath={currentPath}
              highlightedChild={highlightedChild}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
              onAdd={onAdd}
              onDrop={onDrop}
            />
          ))}
          {isActive && !atLimit && (
            <GhostInput
              onSubmit={() => onAdd(context.path)}
              parentPath={context.path}
            />
          )}
          {isActive && atLimit && (
            <div className={styles.limitHint}>
              5 sigils — consider your abstractions
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GhostInput({ onSubmit, parentPath }: { onSubmit: (name: string) => Promise<void>; parentPath: string }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await api.createContext(parentPath, trimmed).catch(console.error);
    setValue("");
    await onSubmit(trimmed);
  };

  return (
    <div className={styles.ghostRow}>
      <span className={styles.expandPlaceholder} />
      <input
        ref={inputRef}
        className={styles.ghostInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="new context..."
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setValue(""); e.currentTarget.blur(); }
        }}
      />
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

  // Listen for menu-triggered rename/move
  useEffect(() => {
    const unlistenRename = listen("rename-sigil-request", () => {
      if (!doc) return;
      const ctx = findContextByPath(doc.sigil.root, doc.currentPath);
      if (ctx) {
        setRenaming({ path: doc.currentPath, name: ctx.name });
      }
    });
    return () => { unlistenRename.then((fn) => fn()); };
  }, [doc]);

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
      await api.renameSigil(doc.sigil.root_path, oldPath, trimmed);
      await reload(doc.sigil.root_path);
      setRenaming(null);
    } catch (err) {
      console.error("Rename failed:", err);
      setRenaming(null);
    }
  };

  const handleMove = async (sourcePath: string, targetPath: string) => {
    try {
      await api.moveSigil(doc.sigil.root_path, sourcePath, targetPath);
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Move failed:", err);
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

  const handleAdd = async () => {
    await reload(doc.sigil.root_path);
  };

  return (
    <div className={styles.tree}>
      <TreeNode
        context={doc.sigil.root}
        path={[]}
        currentPath={doc.currentPath}
        highlightedChild={doc.highlightedChild ?? null}
        onNavigate={handleNavigate}
        onContextMenu={handleContextMenu}
        onAdd={handleAdd}
        onDrop={handleMove}
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
          <button
            className={styles.menuItem}
            onClick={() => {
              api.revealInFinder(contextMenu.context.path).catch(console.error);
              setContextMenu(null);
            }}
          >
            Open in Finder
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
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
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
