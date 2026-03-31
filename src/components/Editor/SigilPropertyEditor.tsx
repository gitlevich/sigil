import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../tauri";
import styles from "./SigilPropertyEditor.module.css";

/** Normalize a property name to a valid reference token: spaces to hyphens. */
function slugify(name: string): string {
  return name.trim().replace(/\s+/g, "-");
}

interface LocalItem {
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
  onNameCommit,
  onContentChange,
  onDelete,
}: {
  item: LocalItem;
  color: string;
  namePlaceholder: string;
  contentPlaceholder: string;
  onNameCommit: (newName: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
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
    fitHeight();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.item}>
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
        <button className={styles.deleteBtn} tabIndex={-1} onClick={onDelete} title={`Delete ${namePlaceholder}`}>x</button>
      </div>
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
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setItems(externalItems.map((a) => ({ savedName: a.name, name: a.name, content: a.content })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigilPath]);

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
    setItems((prev) => prev.map((a) => a.savedName === savedName ? { ...a, savedName: slugged, name: slugged } : a));
    await onReload();
  }, [items, sigilPath, filePrefix, onReload]);

  const handleDelete = useCallback(async (savedName: string) => {
    if (savedName) {
      await api.deleteFile(`${sigilPath}/${filePrefix}-${savedName}.md`).catch(console.error);
    }
    setItems((prev) => prev.filter((a) => a.savedName !== savedName));
    if (savedName) await onReload();
  }, [sigilPath, filePrefix, onReload]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { savedName: "", name: "", content: "" }]);
    setCollapsed(false);
  }, []);

  return (
    <div className={styles.editor} style={{ "--property-color": color } as React.CSSProperties}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={styles.title}>{title}</span>
        {collapsed && items.length > 0 && (
          <div className={styles.chips}>
            {items.map((item, i) => (
              <PropertyChip key={item.savedName || `new-${i}`} item={item} refPrefix={refPrefix} color={color} />
            ))}
          </div>
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
              key={item.savedName || `new-${i}`}
              item={item}
              color={color}
              namePlaceholder={namePlaceholder}
              contentPlaceholder={contentPlaceholder}
              onContentChange={(c) => handleContentChange(item.savedName, c)}
              onNameCommit={(n) => handleNameCommit(item.savedName, n)}
              onDelete={() => handleDelete(item.savedName)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
