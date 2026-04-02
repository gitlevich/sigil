import { useState } from "react";
import styles from "./PropertyBar.module.css";

interface PropertyBarProps {
  title: string;
  refPrefix: string;
  color: string;
  items: { name: string; content: string }[];
}

function Chip({
  name,
  content,
  refPrefix,
  color,
}: {
  name: string;
  content: string;
  refPrefix: string;
  color: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className={styles.chipWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={styles.chip} style={{ color }}>
        {refPrefix}{name}
      </span>
      {hovered && content && (
        <div className={styles.chipPopover}>{content}</div>
      )}
    </span>
  );
}

function PropertyItem({
  name,
  content,
  refPrefix,
  color,
  isFolded,
  onFoldToggle,
}: {
  name: string;
  content: string;
  refPrefix: string;
  color: string;
  isFolded: boolean;
  onFoldToggle: () => void;
}) {
  return (
    <div className={styles.item}>
      <div className={`${styles.itemHeader} ${isFolded ? styles.itemHeaderFolded : ""}`}>
        <button className={styles.foldBtn} onClick={onFoldToggle}>
          {isFolded ? "\u25B6" : "\u25BC"}
        </button>
        <span className={styles.itemName} style={{ color }}>
          {refPrefix}{name}
        </span>
      </div>
      {!isFolded && content && (
        <div className={styles.itemContent}>{content}</div>
      )}
    </div>
  );
}

export function PropertyBar({ title, refPrefix, color, items }: PropertyBarProps) {
  if (items.length === 0) return null;

  const [collapsed, setCollapsed] = useState(true);
  const [foldedItems, setFoldedItems] = useState<Set<string>>(new Set());

  const toggleItemFold = (name: string) => {
    setFoldedItems((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allFolded = items.every((i) => foldedItems.has(i.name));

  const handleBulkFold = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allFolded) {
      setFoldedItems(new Set());
    } else {
      setFoldedItems(new Set(items.map((i) => i.name)));
    }
  };

  return (
    <div className={styles.editor} style={{ "--property-color": color } as React.CSSProperties}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={styles.title}>{title}</span>
        {collapsed && (
          <div className={styles.chips}>
            {items.map((item) => (
              <Chip
                key={item.name}
                name={item.name}
                content={item.content}
                refPrefix={refPrefix}
                color={color}
              />
            ))}
          </div>
        )}
        {!collapsed && items.length > 1 && (
          <button
            className={styles.bulkFoldBtn}
            onClick={handleBulkFold}
            title={allFolded ? "Unfold all" : "Fold all"}
          >
            {allFolded ? "\u25B6" : "\u25BC"}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className={styles.list}>
          {items.map((item) => (
            <PropertyItem
              key={item.name}
              name={item.name}
              content={item.content}
              refPrefix={refPrefix}
              color={color}
              isFolded={foldedItems.has(item.name)}
              onFoldToggle={() => toggleItemFold(item.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
