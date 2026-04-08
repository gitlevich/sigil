import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { SigilFolder, api } from "../../tauri";
import {
  useWorkspaceState, useWorkspaceActions,
} from "../../state/WorkspaceContext";
import { useToast } from "../../hooks/useToast";
import { useMouseDrag } from "../../hooks/useMouseDrag";
import type { DragState } from "../../hooks/useMouseDrag";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import styles from "./TreeView.module.css";

interface ContextMenuState {
  x: number;
  y: number;
  context: SigilFolder;
  path: string[];
}

interface TreeNodeProps {
  context: SigilFolder;
  path: string[];
  currentPath: string[];
  highlightedChild: string | null;
  dragState: DragState;
  onNavigate: (path: string[]) => void;
  onContextMenu: (e: React.MouseEvent, context: SigilFolder, path: string[]) => void;
  onAdd: (parentPath: string) => Promise<void>;
  onDragStart: (e: React.MouseEvent, fsPath: string) => void;
  onTargetEnter: (fsPath: string) => void;
  onTargetLeave: (fsPath: string) => void;
  onTargetDrop: (fsPath: string) => void;
  actionDeps: ActionDeps;
}

function TreeNode({ context, path, currentPath, highlightedChild, dragState, onNavigate, onContextMenu, onAdd, onDragStart, onTargetEnter, onTargetLeave, onTargetDrop, actionDeps }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isActive = JSON.stringify(path) === JSON.stringify(currentPath);
  const isHighlighted = !isActive && highlightedChild === context.name
    && JSON.stringify(path.slice(0, -1)) === JSON.stringify(currentPath);
  const hasChildren = context.children.length > 0;
  const atLimit = context.children.length >= 5;
  const isDropTarget = dragState.targetPath === context.path;
  const isDragSource = dragState.sourcePath === context.path;

  return (
    <div className={styles.node}>
      <div
        className={`${styles.nodeRow} ${isActive ? styles.active : ""} ${isHighlighted ? styles.highlighted : ""} ${isDropTarget ? styles.dropTarget : ""} ${isDragSource ? styles.dragSource : ""}`}
        onMouseDown={(e) => { if (path.length > 0) onDragStart(e, context.path); }}
        onMouseEnter={() => { if (dragState.sourcePath) onTargetEnter(context.path); }}
        onMouseLeave={() => { if (dragState.sourcePath) onTargetLeave(context.path); }}
        onMouseUp={() => { if (dragState.sourcePath) onTargetDrop(context.path); }}
        onClick={() => { if (!dragState.sourcePath) onNavigate(path); }}
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
              dragState={dragState}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
              onAdd={onAdd}
              onDragStart={onDragStart}
              onTargetEnter={onTargetEnter}
              onTargetLeave={onTargetLeave}
              onTargetDrop={onTargetDrop}
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
  const ws = useWorkspaceState();
  const { navigate, reload } = useWorkspaceActions();
  const { addToast } = useToast();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string[]; name: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async () => { await reload(); },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);

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



  const handleNavigate = (path: string[]) => {
    navigate(path);
  };

  const handleContextMenu = (e: React.MouseEvent, context: SigilFolder, path: string[]) => {
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

  const handleMove = useCallback(async (sourcePath: string, targetPath: string) => {
    await actions.moveSigil(sourcePath, targetPath, actionDeps);
  }, [actionDeps]);

  const canDrop = useCallback((src: string, target: string) => {
    if (src === target) return false;
    if (target.startsWith(src + "/")) return false;
    const targetCtx = findContextByFsPath(ws.spec.root, target);
    if (!targetCtx) return false;
    if (targetCtx.children.length >= 5) return false;
    return true;
  }, [ws.spec.root]);

  const { dragState, onDragStart, onTargetEnter, onTargetLeave, onTargetDrop } = useMouseDrag({
    onDrop: handleMove,
    canDrop,
  });

  const handleDelete = async (context: SigilFolder) => {
    if (!await confirm(`Delete "${context.name}" and all its contents? This cannot be undone.`)) {
      return;
    }
    await actions.deleteSigil(context.path, actionDeps);
  };

  const handleAdd = async () => {
    await reload();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    if (e.key === "F2" && ws.currentPath.length > 0) {
      e.preventDefault();
      const ctx = findContextByPath(ws.spec.root, ws.currentPath);
      if (ctx) setRenaming({ path: ws.currentPath, name: ctx.name });
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
    e.preventDefault();

    const allPaths = flattenPaths(ws.spec.root, []);
    const currentKey = JSON.stringify(ws.currentPath);
    const currentIndex = allPaths.findIndex((p) => JSON.stringify(p) === currentKey);

    if (e.key === "ArrowUp" && currentIndex > 0) {
      handleNavigate(allPaths[currentIndex - 1]);
    } else if (e.key === "ArrowDown" && currentIndex < allPaths.length - 1) {
      handleNavigate(allPaths[currentIndex + 1]);
    } else if (e.key === "Enter") {
      const ctx = findContextByPath(ws.spec.root, ws.currentPath);
      if (ctx && ctx.children.length < 5) {
        const ghost = treeRef.current?.querySelector(`.${styles.ghostInput}`) as HTMLInputElement | null;
        if (ghost) ghost.focus();
      }
    }
  };

  return (
    <div className={styles.tree} ref={treeRef} tabIndex={0} onKeyDown={handleKeyDown}>
      <TreeNode
        context={ws.spec.root}
        path={[]}
        currentPath={ws.currentPath}
        highlightedChild={null}
        dragState={dragState}
        onNavigate={handleNavigate}
        onContextMenu={handleContextMenu}
        onAdd={handleAdd}
        onDragStart={onDragStart}
        onTargetEnter={onTargetEnter}
        onTargetLeave={onTargetLeave}
        onTargetDrop={onTargetDrop}
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
                  const ctx = findContextByPath(ws.spec.root, renaming.path);
                  if (ctx) handleRename(ctx.path, renaming.name, e.currentTarget.value);
                }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
              }}
              onBlur={(e) => {
                const ctx = findContextByPath(ws.spec.root, renaming.path);
                if (ctx) handleRename(ctx.path, renaming.name, e.currentTarget.value);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function findContextByFsPath(root: SigilFolder, fsPath: string): SigilFolder | null {
  if (root.path === fsPath) return root;
  for (const child of root.children) {
    const found = findContextByFsPath(child, fsPath);
    if (found) return found;
  }
  return null;
}

function findContextByPath(root: SigilFolder, path: string[]): SigilFolder | null {
  let current: SigilFolder = root;
  for (const seg of path) {
    const child = current.children.find((c) => c.name === seg);
    if (!child) return null;
    current = child;
  }
  return current;
}

function flattenPaths(context: SigilFolder, path: string[]): string[][] {
  const result: string[][] = [path];
  for (const child of context.children) {
    result.push(...flattenPaths(child, [...path, child.name]));
  }
  return result;
}
