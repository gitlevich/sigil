import { useState } from "react";
import styles from "./RefsDropdown.module.css";

export interface RefHit {
  contextName: string;
  contextPath: string[];
  line: string;
}

interface RefsDropdownProps {
  hits: RefHit[];
  x: number;
  y: number;
  onNavigate: (path: string[]) => void;
  onClose: () => void;
}

export function RefsDropdown({ hits, x, y, onNavigate, onClose }: RefsDropdownProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div
      className={styles.dropdown}
      style={{ left: x, top: y }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const hit = hits[activeIndex];
          if (hit) onNavigate(hit.contextPath);
          onClose();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={onClose}
    >
      {hits.map((hit, i) => (
        <div
          key={`${hit.contextPath.join("/")}:${i}`}
          className={`${styles.item} ${i === activeIndex ? styles.itemActive : ""}`}
          onMouseEnter={() => setActiveIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onNavigate(hit.contextPath);
            onClose();
          }}
        >
          <span className={styles.context}>
            {hit.contextPath.length ? hit.contextPath.join(" > ") : hit.contextName}
          </span>
          <span className={styles.line}>{hit.line}</span>
        </div>
      ))}
    </div>
  );
}
