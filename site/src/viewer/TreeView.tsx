import { useState, useRef } from "react";
import type { Context } from "./types";
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { flattenPaths } from "./utils";
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
            {expanded ? "\u25BC" : "\u25B6"}
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
  const { sigil, currentPath } = useViewerState();
  const dispatch = useViewerDispatch();
  const treeRef = useRef<HTMLDivElement>(null);

  const handleNavigate = (path: string[]) => {
    dispatch({ type: "NAVIGATE", path });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();

    const allPaths = flattenPaths(sigil.root, []);
    const currentKey = JSON.stringify(currentPath);
    const currentIndex = allPaths.findIndex(
      (p) => JSON.stringify(p) === currentKey
    );

    if (e.key === "ArrowUp" && currentIndex > 0) {
      handleNavigate(allPaths[currentIndex - 1]);
    } else if (e.key === "ArrowDown" && currentIndex < allPaths.length - 1) {
      handleNavigate(allPaths[currentIndex + 1]);
    }
  };

  return (
    <div
      className={styles.tree}
      ref={treeRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {sigil.root.children.map((child) => (
        <TreeNode
          key={child.name}
          context={child}
          path={[child.name]}
          currentPath={currentPath}
          onNavigate={handleNavigate}
        />
      ))}
    </div>
  );
}
