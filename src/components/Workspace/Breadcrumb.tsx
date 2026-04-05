import { useState, useRef, useEffect, useMemo } from "react";
import { useWorkspaceState, useWorkspaceActions } from "../../state/WorkspaceContext";
import { useToast } from "../../hooks/useToast";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import styles from "./Breadcrumb.module.css";

interface BreadcrumbProps {
  crumbs: { name: string; path: string[] }[];
  onNavigate: (path: string[]) => void;
}

export function Breadcrumb({ crumbs, onNavigate }: BreadcrumbProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ws = useWorkspaceState();
  const { navigate, reload } = useWorkspaceActions();
  const { addToast } = useToast();

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async () => { await reload(); },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const lastCrumb = crumbs[crumbs.length - 1];

  const handleRename = async () => {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === lastCrumb.name) {
      setRenaming(false);
      return;
    }
    const target = findChild(ws.spec.root, lastCrumb.path);
    const contextPath = target ? target.path : ws.spec.root.path;
    await actions.renameContext(contextPath, lastCrumb.name, trimmed, actionDeps);

    const newPath = [...lastCrumb.path];
    if (newPath.length > 0) {
      newPath[newPath.length - 1] = trimmed;
    }
    navigate(newPath);
    setRenaming(false);
  };

  return (
    <div className={styles.breadcrumb}>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className={styles.separator}>&gt;</span>}
            {isLast && renaming ? (
              <input
                ref={inputRef}
                className={styles.renameInput}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(false); }
                }}
                onBlur={handleRename}
              />
            ) : (
              <button
                className={`${styles.crumb} ${isLast ? styles.current : ""}`}
                onClick={() => {
                  if (isLast) {
                    setRenameName(crumb.name);
                    setRenaming(true);
                  } else {
                    onNavigate(crumb.path);
                  }
                }}
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function findChild(root: { children?: { name: string; path: string; children?: unknown[] }[] }, path: string[]) {
  let current: { name: string; path: string; children?: unknown[] } | undefined;
  let node = root as { children?: { name: string; path: string; children?: unknown[] }[] };
  for (const seg of path) {
    current = node.children?.find((c: { name: string }) => c.name === seg);
    if (!current) return undefined;
    node = current as { children?: { name: string; path: string; children?: unknown[] }[] };
  }
  return current;
}
