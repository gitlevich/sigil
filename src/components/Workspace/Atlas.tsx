import { useState, useEffect, useRef } from "react";
import {
  useWorkspaceState, useWorkspaceActions, resolveCurrentFolder,
} from "../../state/WorkspaceContext";
import { api, SigilFolder } from "../../tauri";
import { useActionDeps } from "../../hooks/useActionDeps";
import * as actions from "../../actions/workspace";
import { buildPath, type Context as CoreContext } from "sigil-core";
import { Atlas as AtlasView } from "sigil-core/react/Atlas";
import styles from "./Atlas.module.css";

export function Atlas() {
  const ws = useWorkspaceState();
  const { navigate } = useWorkspaceActions();

  const actionDeps = useActionDeps();

  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; ctx: SigilFolder } | null>(null);
  const [deleting, setDeleting] = useState<{ path: string; name: string } | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);

  const currentFolder = resolveCurrentFolder(ws);

  useEffect(() => {
    if (!nodeMenu) return;
    const hide = () => setNodeMenu(null);
    document.addEventListener("click", hide);
    return () => document.removeEventListener("click", hide);
  }, [nodeMenu]);

  useEffect(() => {
    if (deleting && deleteConfirmRef.current) deleteConfirmRef.current.focus();
  }, [deleting]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await actions.deleteSigil(target.path, actionDeps);
  };

  const handleNavigate = (ctx: CoreContext) => {
    const path = buildPath(ws.spec.root, ctx.name, []);
    if (path) {
      navigate(path);
    }
  };

  const handleEscape = ws.currentPath.length > 1
    ? () => navigate(ws.currentPath.slice(0, -1))
    : undefined;

  if (!currentFolder) return null;

  const dark = document.documentElement.getAttribute("data-theme") === "dark";

  return (
    <div className={styles.container}>
      <AtlasView
        children={currentFolder.children}
        dark={dark}
        onNavigate={handleNavigate}
        onEscape={handleEscape}
        onContextMenu={(e, ctx) => setNodeMenu({ x: e.clientX, y: e.clientY, ctx: ctx as unknown as SigilFolder })}
        instructions="Double-click to enter a sigil. Right-click for options."
        revealedStorageKey="sigil-map-revealed"
      />

      {nodeMenu && (
        <div
          className={styles.nodeContextMenu}
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.menuHeader}>{nodeMenu.ctx.name}</div>
          <div className={styles.menuList}>
            <button
              className={styles.menuItem}
              onClick={async () => {
                const name = prompt("Rename:", nodeMenu.ctx.name);
                if (!name?.trim()) { setNodeMenu(null); return; }
                await actions.renameContext(nodeMenu.ctx.path, nodeMenu.ctx.name, name.trim(), actionDeps);
                setNodeMenu(null);
              }}
            >
              Rename
            </button>
            <button
              className={styles.menuItem}
              onClick={() => {
                api.revealInFinder(nodeMenu.ctx.path).catch(console.error);
                setNodeMenu(null);
              }}
            >
              Open in Finder
            </button>
            <button
              className={styles.menuItemDanger}
              onClick={() => {
                setDeleting({ path: nodeMenu.ctx.path, name: nodeMenu.ctx.name });
                setNodeMenu(null);
              }}
            >
              Delete
            </button>
          </div>
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
              Delete "{deleting.name}" and all its contents? This cannot be undone.
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
