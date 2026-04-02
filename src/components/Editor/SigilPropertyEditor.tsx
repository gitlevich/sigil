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
  isFolded,
  onNameCommit,
  onContentChange,
  onDelete,
  onFoldToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  item: LocalItem;
  color: string;
  namePlaceholder: string;
  contentPlaceholder: string;
  isDragOver: boolean;
  isFolded: boolean;
  onNameCommit: (newName: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onFoldToggle: () => void;
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
    if (!isFolded) fitHeight();
  }, [isFolded, fitHeight]);

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
      <div className={`${styles.itemHeader} ${isFolded ? styles.itemHeaderFolded : ""}`}>
        <button className={styles.foldBtn} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onFoldToggle(); }} title="Toggle fold">
          {isFolded ? "\u25B6" : "\u25BC"}
        </button>
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
        <button className={styles.deleteBtn} tabIndex={-1} onClick={onDelete} title={`Delete ${namePlaceholder}`}>x</button>
      </div>
      {!isFolded && (
        <textarea
          ref={textareaRef}
          className={styles.contentArea}
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
      )}
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
  const [foldedItems, setFoldedItems] = useState<Set<string>>(new Set());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragSourceIndex = useRef<number | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const orderPath = `${sigilPath}/${filePrefix}.order`;
  const foldPath = `${sigilPath}/${filePrefix}.folded`;

  const applyOrder = useCallback((raw: LocalItem[], order: string[]): LocalItem[] => {
    const indexed = new Map(raw.map((item) => [item.savedName, item]));
    const ordered = order.flatMap((name) => indexed.has(name) ? [indexed.get(name)!] : []);
    const rest = raw.filter((item) => !order.includes(item.savedName));
    return [...ordered, ...rest];
  }, []);

  const externalKey = externalItems.map((a) => a.name).sort().join("\0");

  useEffect(() => {
    const raw = externalItems.map((a) => ({ id: a.name, savedName: a.name, name: a.name, content: a.content }));
    Promise.allSettled([api.readFile(orderPath), api.readFile(foldPath)]).then(([orderResult, foldResult]) => {
      if (orderResult.status === "fulfilled") {
        try {
          const order: string[] = JSON.parse(orderResult.value);
          setItems(applyOrder(raw, order));
        } catch {
          setItems(raw);
        }
      } else {
        setItems(raw);
      }
      if (foldResult.status === "fulfilled") {
        try {
          setFoldedItems(new Set(JSON.parse(foldResult.value) as string[]));
        } catch {
          setFoldedItems(new Set());
        }
      } else {
        setFoldedItems(new Set());
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigilPath, externalKey]);

  const saveOrder = useCallback((ordered: LocalItem[]) => {
    const names = ordered.map((i) => i.savedName).filter(Boolean);
    api.writeFile(orderPath, JSON.stringify(names)).catch(console.error);
  }, [orderPath]);

  const saveFold = useCallback((folded: Set<string>) => {
    api.writeFile(foldPath, JSON.stringify([...folded])).catch(console.error);
  }, [foldPath]);

  const toggleItemFold = useCallback((savedName: string) => {
    setFoldedItems((prev) => {
      const next = new Set(prev);
      if (next.has(savedName)) next.delete(savedName);
      else next.add(savedName);
      saveFold(next);
      return next;
    });
  }, [saveFold]);

  const handleBulkFold = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const allNames = items.map((i) => i.savedName).filter(Boolean);
    const allFolded = allNames.length > 0 && allNames.every((n) => foldedItems.has(n));
    const next = allFolded ? new Set<string>() : new Set(allNames);
    setFoldedItems(next);
    saveFold(next);
  }, [items, foldedItems, saveFold]);

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
    setFoldedItems((prev) => {
      if (!prev.has(savedName)) return prev;
      const next = new Set(prev);
      next.delete(savedName);
      next.add(slugged);
      saveFold(next);
      return next;
    });
    await onReload();
  }, [items, sigilPath, filePrefix, onReload, saveOrder, saveFold]);

  const handleDelete = useCallback(async (savedName: string) => {
    if (savedName) {
      await api.deleteFile(`${sigilPath}/${filePrefix}-${savedName}.md`).catch(console.error);
    }
    setItems((prev) => {
      const updated = prev.filter((a) => a.savedName !== savedName);
      saveOrder(updated);
      return updated;
    });
    if (savedName) {
      setFoldedItems((prev) => {
        if (!prev.has(savedName)) return prev;
        const next = new Set(prev);
        next.delete(savedName);
        saveFold(next);
        return next;
      });
      await onReload();
    }
  }, [sigilPath, filePrefix, onReload, saveOrder, saveFold]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { id: `new-${Date.now()}`, savedName: "", name: "", content: "" }]);
    setCollapsed(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
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
    <div ref={listRef} className={styles.editor} style={{ "--property-color": color } as React.CSSProperties}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={styles.title}>{title}</span>
        {collapsed && items.length > 0 && (
          <div className={styles.chips}>
            {items.map((item) => (
              <PropertyChip key={item.id} item={item} refPrefix={refPrefix} color={color} />
            ))}
          </div>
        )}
        {!collapsed && items.length > 0 && (
          <button
            className={styles.bulkFoldBtn}
            onClick={handleBulkFold}
            title={items.filter((i) => i.savedName).every((i) => foldedItems.has(i.savedName)) ? "Unfold all" : "Fold all"}
          >
            {items.filter((i) => i.savedName).every((i) => foldedItems.has(i.savedName)) ? "\u25B6" : "\u25BC"}
          </button>
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
              isFolded={foldedItems.has(item.savedName)}
              onContentChange={(c) => handleContentChange(item.savedName, c)}
              onNameCommit={(n) => handleNameCommit(item.savedName, n)}
              onDelete={() => handleDelete(item.savedName)}
              onFoldToggle={() => toggleItemFold(item.savedName)}
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
