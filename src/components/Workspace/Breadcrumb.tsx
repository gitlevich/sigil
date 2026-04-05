import { useState, useRef, useEffect, useMemo } from "react";
import { useSigil } from "../../hooks/useSigil";
import { useAppDispatch, useDocument } from "../../state/AppContext";
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
  const { reload } = useSigil();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { addToast } = useToast();

  const actionDeps: ActionDeps = useMemo(() => ({
    rootPath: doc?.sigil.root_path ?? "",
    reload,
    addToast,
  }), [doc?.sigil.root_path, reload, addToast]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const lastCrumb = crumbs[crumbs.length - 1];

  const handleRename = async () => {
    if (!doc) return;
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === lastCrumb.name) {
      setRenaming(false);
      return;
    }
    const target = findChild(doc.sigil.root, lastCrumb.path);
    const contextPath = target ? target.path : doc.sigil.root.path;
    await actions.renameContext(contextPath, lastCrumb.name, trimmed, actionDeps);

    const newPath = [...lastCrumb.path];
    if (newPath.length > 0) {
      newPath[newPath.length - 1] = trimmed;
    }
    dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: newPath } });
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
