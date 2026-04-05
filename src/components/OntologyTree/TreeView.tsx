import { useState, useEffect, useRef, useMemo } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Context, api } from "../../tauri";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { useSigil } from "../../hooks/useSigil";
import { useToast } from "../../hooks/useToast";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import styles from "./TreeView.module.css";

/** Workaround: Tauri webview blocks dataTransfer.getData() for custom MIME types in onDrop. */
let dragSourcePath: string | null = null;

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
  actionDeps: ActionDeps;
}

function TreeNode({ context, path, currentPath, highlightedChild, onNavigate, onContextMenu, onAdd, onDrop, actionDeps }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropTarget, setDropTarget] = useState(false);
  const isActive = JSON.stringify(path) === JSON.stringify(currentPath);
  // Highlighted if this node is the highlightedChild of the active node's parent
  const isHighlighted = !isActive && highlightedChild === context.name
    && JSON.stringify(path.slice(0, -1)) === JSON.stringify(currentPath);
  const hasChildren = context.children.length > 0;
  const atLimit = context.children.length >= 5;

  return (
    <div
      className={styles.node}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!atLimit) {
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        } else {
          e.dataTransfer.dropEffect = "none";
        }
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the entire node subtree
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropTarget(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(false);
        const sourcePath = dragSourcePath;
        dragSourcePath = null;
        if (!sourcePath) return;
        if (atLimit) return;
        if (sourcePath === context.path) return;
        if (context.path.startsWith(sourcePath + "/")) return;
        onDrop(sourcePath, context.path);
      }}
    >
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
          e.stopPropagation();
          dragSourcePath = context.path;
          e.dataTransfer.effectAllowed = "move";
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
            {expanded ? "\u25BC" : "\u25B6"}
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
              actionDeps={actionDeps}
            />
          ))}
          {isActive && !atLimit && (
            <GhostInput
              onSubmit={() => onAdd(context.path)}
              parentPath={context.path}
              actionDeps={actionDeps}
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

function GhostInput({ onSubmit, parentPath, actionDeps }: { onSubmit: (name: string) => Promise<void>; parentPath: string; actionDeps: ActionDeps }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await actions.createContext(parentPath, trimmed, actionDeps);
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
  const { addToast } = useToast();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string[]; name: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: doc?.sigil.root_path ?? "",
    reload,
    addToast,
  }), [doc?.sigil.root_path, reload, addToast]);

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

  // React to menu/shortcut rename request
  useEffect(() => {
    if (!doc?.renamingRequest) return;
    dispatch({ type: "UPDATE_DOCUMENT", updates: { renamingRequest: false } });
    const ctx = findContextByPath(doc.sigil.root, doc.currentPath);
    if (ctx) {
      setRenaming({ path: doc.currentPath, name: ctx.name });
    }
  }, [doc?.renamingRequest, doc?.currentPath, doc?.sigil.root, dispatch]);

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
    await actions.renameSigil(oldPath, trimmed, actionDeps);
    setRenaming(null);
  };

  const handleMove = async (sourcePath: string, targetPath: string) => {
    await actions.moveSigil(sourcePath, targetPath, actionDeps);
  };

  const handleDelete = async (context: Context) => {
    if (!await confirm(`Delete "${context.name}" and all its contents? This cannot be undone.`)) {
      return;
    }
    await actions.deleteSigil(context.path, actionDeps);
  };

  const handleAdd = async () => {
    await reload(doc.sigil.root_path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
    e.preventDefault();

    const allPaths = flattenPaths(doc.sigil.root, []);
    const currentKey = JSON.stringify(doc.currentPath);
    const currentIndex = allPaths.findIndex((p) => JSON.stringify(p) === currentKey);

    if (e.key === "ArrowUp" && currentIndex > 0) {
      handleNavigate(allPaths[currentIndex - 1]);
    } else if (e.key === "ArrowDown" && currentIndex < allPaths.length - 1) {
      handleNavigate(allPaths[currentIndex + 1]);
    } else if (e.key === "Enter") {
      const ctx = findContextByPath(doc.sigil.root, doc.currentPath);
      if (ctx && ctx.children.length < 5) {
        // Focus the ghost input if it exists
        const ghost = treeRef.current?.querySelector(`.${styles.ghostInput}`) as HTMLInputElement | null;
        if (ghost) ghost.focus();
      }
    }
  };

  return (
    <div className={styles.tree} ref={treeRef} tabIndex={0} onKeyDown={handleKeyDown} onDragOver={(e) => e.preventDefault()}>
      <TreeNode
        context={doc.sigil.root}
        path={[]}
        currentPath={doc.currentPath}
        highlightedChild={doc.highlightedChild ?? null}
        onNavigate={handleNavigate}
        onContextMenu={handleContextMenu}
        onAdd={handleAdd}
        onDrop={handleMove}
        actionDeps={actionDeps}
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

/** Flatten the tree into a list of paths in visible (depth-first) order. */
function flattenPaths(context: Context, path: string[]): string[][] {
  const result: string[][] = [path];
  for (const child of context.children) {
    result.push(...flattenPaths(child, [...path, child.name]));
  }
  return result;
}
