import { useState, useEffect } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useDocument, useAppDispatch } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useSigil } from "../../hooks/useSigil";
import { findContext as coreFindContext, buildPath, type Context as CoreContext } from "sigil-core";
import { Atlas } from "sigil-core/react/Atlas";
import styles from "./Map.module.css";

function findContext(root: Context, path: string[]): Context {
  return coreFindContext(root, path) as Context;
}

export function SigilMap() {
  const doc = useDocument();
  const dispatch = useAppDispatch();
  const { reload } = useSigil();

  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; ctx: Context } | null>(null);

  const currentCtx = doc ? findContext(doc.sigil.root, doc.currentPath) : null;

  useEffect(() => {
    if (!nodeMenu) return;
    const hide = () => setNodeMenu(null);
    document.addEventListener("click", hide);
    return () => document.removeEventListener("click", hide);
  }, [nodeMenu]);

  const handleNavigate = (ctx: CoreContext) => {
    if (!doc) return;
    const path = buildPath(doc.sigil.root, ctx.name, []);
    if (path) {
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } });
    }
  };

  const handleEscape = doc && doc.currentPath.length > 1
    ? () => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: doc.currentPath.slice(0, -1) } })
    : undefined;

  if (!doc || !currentCtx) return null;

  const dark = document.documentElement.getAttribute("data-theme") === "dark";

  return (
    <div className={styles.container}>
      <Atlas
        children={currentCtx.children}
        dark={dark}
        onNavigate={handleNavigate}
        onEscape={handleEscape}
        onContextMenu={(e, ctx) => setNodeMenu({ x: e.clientX, y: e.clientY, ctx: ctx as unknown as Context })}
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
              onClick={() => {
                const name = prompt("Rename:", nodeMenu.ctx.name);
                if (!name?.trim()) { setNodeMenu(null); return; }
                api.renameContext(doc!.sigil.root_path, nodeMenu.ctx.path, name.trim())
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
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
                api.deleteContext(nodeMenu.ctx.path)
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
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
