import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../tauri";
import styles from "./SigilPropertyEditor.module.css";

/** Normalize a property name to a valid reference token: spaces to hyphens. */
function slugify(name: string): string {
  return name.trim().replace(/\s+/g, "-");
}

interface LocalItem {
  id: string;
  /** Name currently on disk; empty string for unsaved new items. */
  savedName: string;
  name: string;
  content: string;
}

interface SigilPropertyEditorProps {
  sigilPath: string;
  filePrefix: string;
  title: string;
  refPrefix: string;
  color: string;
  namePlaceholder: string;
  contentPlaceholder: string;
  items: { name: string; content: string }[];
  onReload: () => Promise<void>;
}

function PropertyChip({ item, refPrefix, color }: { item: LocalItem; refPrefix: string; color: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className={styles.chip}
      style={{ "--property-color": color } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {refPrefix}{item.name || "..."}
      {hovered && item.content && (
        <div className={styles.chipPopover}>{item.content}</div>
      )}
    </span>
  );
}

function PropertyItem({
  item,
  color,
  namePlaceholder,
  contentPlaceholder,
  isDragOver,
  folded,
  onToggleFold,
  onNameCommit,
  onContentChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  item: LocalItem;
  color: string;
  namePlaceholder: string;
  contentPlaceholder: string;
  isDragOver: boolean;
  folded: boolean;
  onToggleFold: () => void;
  onNameCommit: (newName: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const [nameValue, setNameValue] = useState(item.name);
  const contentBeforeEdit = useRef(item.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fitHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (!folded) fitHeight();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folded]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => fitHeight());
    observer.observe(ta);
    return () => observer.disconnect();
  }, [fitHeight]);

  return (
    <div
      className={`${styles.item} ${isDragOver ? styles.itemDragOver : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <span
        className={styles.dragHandle}
        title="Drag to reorder"
        draggable
        onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      >⠿</span>
      <div className={styles.itemBody}>
      <div className={styles.itemHeader}>
        <input
          className={styles.nameInput}
          style={{ "--property-color": color } as React.CSSProperties}
          value={nameValue}
          placeholder={namePlaceholder}
          onChange={(e) => setNameValue(e.target.value.replace(/\s/g, "-"))}
          onBlur={() => {
            const v = slugify(nameValue);
            setNameValue(v);
            if (v && v !== item.savedName) onNameCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              textareaRef.current?.focus();
            }
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setNameValue(item.savedName);
              e.currentTarget.blur();
            }
          }}
        />
        <button className={styles.foldBtn} tabIndex={-1} onClick={onToggleFold} title={folded ? "Unfold" : "Fold"}>{folded ? "\u25B6" : "\u25BC"}</button>
        <button className={styles.deleteBtn} tabIndex={-1} onClick={onDelete} title={`Delete ${namePlaceholder}`}>x</button>
      </div>
      <textarea
        ref={textareaRef}
        className={`${styles.contentArea} ${folded ? styles.contentFolded : ""}`}
        value={item.content}
        placeholder={contentPlaceholder}
        onChange={(e) => { onContentChange(e.target.value); fitHeight(); }}
        onFocus={() => { contentBeforeEdit.current = item.content; }}
        onBlur={fitHeight}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            contentBeforeEdit.current = item.content;
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            onContentChange(contentBeforeEdit.current);
            e.currentTarget.blur();
          }
        }}
      />
      </div>
    </div>
  );
}

export function SigilPropertyEditor({
  sigilPath,
  filePrefix,
  title,
  refPrefix,
  color,
  namePlaceholder,
  contentPlaceholder,
  items: externalItems,
  onReload,
}: SigilPropertyEditorProps) {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [foldedSet, setFoldedSet] = useState<Set<string>>(new Set());
  const [allFolded, setAllFolded] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragSourceIndex = useRef<number | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const orderPath = `${sigilPath}/${filePrefix}.order`;

  const applyOrder = useCallback((raw: LocalItem[], order: string[]): LocalItem[] => {
    const indexed = new Map(raw.map((item) => [item.savedName, item]));
    const ordered = order.flatMap((name) => indexed.has(name) ? [indexed.get(name)!] : []);
    const rest = raw.filter((item) => !order.includes(item.savedName));
    return [...ordered, ...rest];
  }, []);

  const externalKey = externalItems.map((a) => a.name).sort().join("\0");

  useEffect(() => {
    const raw = externalItems.map((a) => ({ id: a.name, savedName: a.name, name: a.name, content: a.content }));
    api.readFile(orderPath)
      .then((json) => {
        try {
          const order: string[] = JSON.parse(json);
          setItems(applyOrder(raw, order));
        } catch {
          setItems(raw);
        }
      })
      .catch(() => setItems(raw));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigilPath, externalKey]);

  const saveOrder = useCallback((ordered: LocalItem[]) => {
    const names = ordered.map((i) => i.savedName).filter(Boolean);
    api.writeFile(orderPath, JSON.stringify(names)).catch(console.error);
  }, [orderPath]);

  const scheduleSave = useCallback((name: string, content: string) => {
    clearTimeout(saveTimers.current[name]);
    saveTimers.current[name] = setTimeout(() => {
      api.writeFile(`${sigilPath}/${filePrefix}-${name}.md`, content).catch(console.error);
    }, 400);
  }, [sigilPath, filePrefix]);

  const handleContentChange = useCallback((savedName: string, content: string) => {
    setItems((prev) => prev.map((a) => a.savedName === savedName ? { ...a, content } : a));
    if (savedName) scheduleSave(savedName, content);
  }, [scheduleSave]);

  const handleNameCommit = useCallback(async (savedName: string, newName: string) => {
    const slugged = slugify(newName);
    if (!slugged) return;
    const item = items.find((a) => a.savedName === savedName);
    if (!item) return;
    if (savedName) {
      await api.deleteFile(`${sigilPath}/${filePrefix}-${savedName}.md`).catch(console.error);
    }
    await api.writeFile(`${sigilPath}/${filePrefix}-${slugged}.md`, item.content).catch(console.error);
    setItems((prev) => {
      const updated = prev.map((a) => a.savedName === savedName ? { ...a, id: slugged, savedName: slugged, name: slugged } : a);
      saveOrder(updated);
      return updated;
    });
    await onReload();
  }, [items, sigilPath, filePrefix, onReload, saveOrder]);

  const handleDelete = useCallback(async (savedName: string) => {
    if (savedName) {
      await api.deleteFile(`${sigilPath}/${filePrefix}-${savedName}.md`).catch(console.error);
    }
    setItems((prev) => {
      const updated = prev.filter((a) => a.savedName !== savedName);
      saveOrder(updated);
      return updated;
    });
    if (savedName) await onReload();
  }, [sigilPath, filePrefix, onReload, saveOrder]);

  const handleToggleFold = useCallback((id: string) => {
    setFoldedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleToggleFoldAll = useCallback(() => {
    setAllFolded((prev) => {
      const next = !prev;
      if (next) {
        setFoldedSet(new Set(items.map((i) => i.id)));
      } else {
        setFoldedSet(new Set());
      }
      return next;
    });
  }, [items]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { id: `new-${Date.now()}`, savedName: "", name: "", content: "" }]);
    setCollapsed(false);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => {
    const src = dragSourceIndex.current;
    if (src === null || src === targetIndex) { setDragOverIndex(null); return; }
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(src, 1);
      next.splice(targetIndex, 0, moved);
      saveOrder(next);
      return next;
    });
    dragSourceIndex.current = null;
    setDragOverIndex(null);
  }, [saveOrder]);

  return (
    <div className={styles.editor} style={{ "--property-color": color } as React.CSSProperties}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={styles.title}>{title}</span>
        {collapsed && items.length > 0 && (
          <div className={styles.chips}>
            {items.map((item, i) => (
              <PropertyChip key={item.id} item={item} refPrefix={refPrefix} color={color} />
            ))}
          </div>
        )}
        {!collapsed && items.length > 1 && (
          <button
            className={styles.foldAllBtn}
            onClick={(e) => { e.stopPropagation(); handleToggleFoldAll(); }}
            title={allFolded ? "Unfold all" : "Fold all"}
          >{allFolded ? "unfold" : "fold"}</button>
        )}
        <button
          className={styles.addBtn}
          onClick={(e) => { e.stopPropagation(); handleAdd(); }}
          title={`Add ${namePlaceholder}`}
        >+</button>
      </div>
      {!collapsed && items.length > 0 && (
        <div className={styles.list}>
          {items.map((item, i) => (
            <PropertyItem
              key={item.id}
              item={item}
              color={color}
              namePlaceholder={namePlaceholder}
              contentPlaceholder={contentPlaceholder}
              isDragOver={dragOverIndex === i}
              folded={foldedSet.has(item.id)}
              onToggleFold={() => handleToggleFold(item.id)}
              onContentChange={(c) => handleContentChange(item.savedName, c)}
              onNameCommit={(n) => handleNameCommit(item.savedName, n)}
              onDelete={() => handleDelete(item.savedName)}
              onDragStart={() => { dragSourceIndex.current = i; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
              onDrop={() => handleDrop(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
