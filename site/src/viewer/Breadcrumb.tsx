import { useViewerState, useViewerDispatch } from "./ViewerState";
import { buildBreadcrumb } from "./utils";
import styles from "./Breadcrumb.module.css";

export function Breadcrumb() {
  const { sigil, currentPath } = useViewerState();
  const dispatch = useViewerDispatch();
  const crumbs = buildBreadcrumb(sigil.root, currentPath);

  return (
    <div className={styles.breadcrumb}>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className={styles.separator}>&gt;</span>}
            <button
              className={`${styles.crumb} ${isLast ? styles.current : ""}`}
              onClick={() => dispatch({ type: "NAVIGATE", path: crumb.path })}
            >
              {crumb.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
