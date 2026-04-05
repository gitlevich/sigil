import { useState, useEffect, useMemo } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  useWorkspaceState, useWorkspaceActions, resolveCurrentFolder,
} from "../../state/WorkspaceContext";
import { api, SigilFolder } from "../../tauri";
import { useToast } from "../../hooks/useToast";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import { buildPath, type Context as CoreContext } from "sigil-core";
import { Atlas as AtlasView } from "sigil-core/react/Atlas";
import styles from "./Atlas.module.css";

export function Atlas() {
  const ws = useWorkspaceState();
  const { navigate, reload } = useWorkspaceActions();
  const { addToast } = useToast();

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async () => { await reload(); },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);

  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; ctx: SigilFolder } | null>(null);

  const currentFolder = resolveCurrentFolder(ws);

  useEffect(() => {
    if (!nodeMenu) return;
    const hide = () => setNodeMenu(null);
    document.addEventListener("click", hide);
    return () => document.removeEventListener("click", hide);
  }, [nodeMenu]);

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
              onClick={async () => {
                if (!await confirm(`Delete "${nodeMenu.ctx.name}" and all its contents?`)) { setNodeMenu(null); return; }
                await actions.deleteSigil(nodeMenu.ctx.path, actionDeps);
                setNodeMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
