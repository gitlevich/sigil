/**
 * NameMisfitStatusBar — surfaces #probe-name-misfit.
 *
 * Spec path: Idea/Workspace/affordance-probe-name-misfit
 *
 * The RightHemisphere's #senses-name-misfit faculty produces a list of
 * suspicions — @references that resolve but sit in the wrong neighborhood
 * for their line. This bar lets either inhabitant inspect that list
 * on-demand, without waiting for the feeling to cross EscalationThreshold.
 */
import { useState } from "react";
import type { NameMisfit } from "../../hooks/useNameMisfits";
import styles from "./NameMisfitStatusBar.module.css";

interface NameMisfitStatusBarProps {
  misfits: NameMisfit[];
  onNavigateToMisfit?: (misfit: NameMisfit) => void;
}

function groupByPath(misfits: NameMisfit[]): Map<string, NameMisfit[]> {
  const grouped = new Map<string, NameMisfit[]>();
  for (const m of misfits) {
    const key = m.path.join("/") + "/" + m.file;
    const list = grouped.get(key) ?? [];
    list.push(m);
    grouped.set(key, list);
  }
  return grouped;
}

export function NameMisfitStatusBar({ misfits, onNavigateToMisfit }: NameMisfitStatusBarProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMisfits = misfits.length > 0;

  return (
    <div className={`${styles.container} ${expanded && hasMisfits ? styles.containerExpanded : ""}`}>
      <div
        className={`${styles.bar} ${hasMisfits ? styles.barMisfit : styles.barQuiet}`}
        onClick={() => hasMisfits && setExpanded(!expanded)}
      >
        <span className={styles.indicator}>
          {hasMisfits ? (
            <>
              <span className={styles.dot + " " + styles.dotMisfit} />
              {misfits.length} name{misfits.length !== 1 ? "s" : ""} feel{misfits.length !== 1 ? "" : "s"} out of place
            </>
          ) : (
            <>
              <span className={styles.dot + " " + styles.dotQuiet} />
              no names feel out of place
            </>
          )}
        </span>
      </div>

      {expanded && hasMisfits && (
        <div className={`${styles.panel} ${styles.panelExpanded}`}>
          {Array.from(groupByPath(misfits)).map(([fileKey, entries]) => (
            <div key={fileKey} className={styles.fileGroup}>
              <div
                className={styles.filePath}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onNavigateToMisfit && entries[0]) onNavigateToMisfit(entries[0]);
                }}
              >
                {fileKey}
              </div>
              {entries.map((m, i) => (
                <div
                  key={i}
                  className={styles.misfitLine}
                  onClick={(e) => { e.stopPropagation(); onNavigateToMisfit?.(m); }}
                >
                  <span className={styles.lineNum}>{m.line}</span>
                  <span className={styles.refToken}>{m.ref}</span>
                  <span className={styles.reason}>{m.reason}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
