import { useState, useRef, useEffect } from "react";
import { api } from "../../tauri";
import { useSpecTree } from "../../hooks/useSpecTree";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import styles from "./Breadcrumb.module.css";

interface BreadcrumbProps {
  crumbs: { name: string; path: string[] }[];
  onNavigate: (path: string[]) => void;
}

export function Breadcrumb({ crumbs, onNavigate }: BreadcrumbProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { reload } = useSpecTree();
  const dispatch = useAppDispatch();
  const doc = useDocument();

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
    try {
      const target = findChild(doc.specTree.root, lastCrumb.path);
      const contextPath = target ? target.path : doc.specTree.root.path;
      await api.renameContext(contextPath, trimmed);

      const newPath = [...lastCrumb.path];
      if (newPath.length > 0) {
        newPath[newPath.length - 1] = trimmed;
      }
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: newPath } });

      await reload(doc.specTree.root_path);
      setRenaming(false);
    } catch (err) {
      console.error("Rename failed:", err);
      setRenaming(false);
    }
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
                  if (e.key === "Escape") setRenaming(false);
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
