import { useState } from "react";
import { Context } from "../../tauri";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import styles from "./TreeView.module.css";

interface TreeNodeProps {
  context: Context;
  path: string[];
  currentPath: string[];
  onNavigate: (path: string[]) => void;
}

function TreeNode({ context, path, currentPath, onNavigate }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isActive = JSON.stringify(path) === JSON.stringify(currentPath);
  const hasChildren = context.children.length > 0;

  return (
    <div className={styles.node}>
      <div
        className={`${styles.nodeRow} ${isActive ? styles.active : ""}`}
        onClick={() => onNavigate(path)}
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

  if (!doc) return null;

  const handleNavigate = (path: string[]) => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } });
  };

  return (
    <div className={styles.tree}>
      <TreeNode
        context={doc.specTree.root}
        path={[]}
        currentPath={doc.currentPath}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
