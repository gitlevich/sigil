import type { Context } from "./types";
import { useViewerState, useViewerDispatch } from "./ViewerState";
import styles from "./SubContextBar.module.css";

interface SubContextBarProps {
  context: Context;
}

export function SubContextBar({ context }: SubContextBarProps) {
  const { currentPath } = useViewerState();
  const dispatch = useViewerDispatch();

  if (context.children.length === 0) return null;

  return (
    <div className={styles.bar}>
      {context.children.map((child) => (
        <div
          key={child.name}
          className={styles.box}
          onClick={() =>
            dispatch({ type: "NAVIGATE", path: [...currentPath, child.name] })
          }
        >
          {child.name}
        </div>
      ))}
    </div>
  );
}
