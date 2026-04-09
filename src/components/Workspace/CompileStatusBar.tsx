import { useState } from "react";
import type { CompileResult, RefError } from "../../hooks/useCompileCheck";
import styles from "./CompileStatusBar.module.css";

interface CompileStatusBarProps {
  result: CompileResult;
  currentPath: string[];
  onNavigateToError?: (error: RefError) => void;
}

function groupByPath(errors: RefError[]): Map<string, RefError[]> {
  const grouped = new Map<string, RefError[]>();
  for (const err of errors) {
    const key = err.path.join("/") + "/" + err.file;
    const list = grouped.get(key) ?? [];
    list.push(err);
    grouped.set(key, list);
  }
  return grouped;
}

function isInScope(errorPath: string[], currentPath: string[]): boolean {
  if (currentPath.length === 0) return true;
  for (let i = 0; i < currentPath.length; i++) {
    if (errorPath[i] !== currentPath[i]) return false;
  }
  return true;
}

export function CompileStatusBar({ result, currentPath, onNavigateToError }: CompileStatusBarProps) {
  const [expanded, setExpanded] = useState(false);
  const scopedErrors = result.errors.filter(e => isInScope(e.path, currentPath));
  const scopedFiles = new Set(scopedErrors.map(e => e.path.join("/") + "/" + e.file));
  const hasErrors = scopedErrors.length > 0;

  return (
    <div className={styles.container}>
      <div
        className={`${styles.bar} ${hasErrors ? styles.barError : styles.barClean}`}
        onClick={() => hasErrors && setExpanded(!expanded)}
      >
        <span className={styles.indicator}>
          {hasErrors ? (
            <>
              <span className={styles.dot + " " + styles.dotError} />
              {scopedErrors.length} unresolved in {scopedFiles.size} file{scopedFiles.size !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              <span className={styles.dot + " " + styles.dotClean} />
              {result.totalRefs} references — all resolve
            </>
          )}
        </span>
      </div>

      {expanded && hasErrors && (
        <div className={styles.panel}>
          {Array.from(groupByPath(scopedErrors)).map(([fileKey, errors]) => (
            <div key={fileKey} className={styles.fileGroup}>
              <div
                className={styles.filePath}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onNavigateToError && errors[0]) {
                    onNavigateToError(errors[0]);
                  }
                }}
              >
                {fileKey}
              </div>
              {errors.map((err, i) => (
                <div
                  key={i}
                  className={styles.errorLine}
                  onClick={(e) => { e.stopPropagation(); onNavigateToError?.(err); }}
                >
                  <span className={styles.lineNum}>{err.line}</span>
                  <span className={styles.refToken}>{err.ref}</span>
                  <span className={styles.reason}>{err.reason}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
