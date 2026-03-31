import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Affordance, api } from "../../tauri";
import styles from "./AffordanceEditor.module.css";

/** Normalize an affordance name to a valid #reference token: spaces → hyphens. */
function slugify(name: string): string {
  return name.trim().replace(/\s+/g, "-");
}

interface LocalAffordance {
  /** Name currently on disk; empty string for unsaved new affordances. */
  savedName: string;
  name: string;
  content: string;
}

interface AffordanceEditorProps {
  sigilPath: string;
  affordances: Affordance[];
  onReload: () => Promise<void>;
}

function AffordanceChip({ item }: { item: LocalAffordance }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className={styles.chip}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      #{item.name || "…"}
      {hovered && item.content && (
        <div className={styles.chipPopover}>{item.content}</div>
      )}
    </span>
  );
}

function AffordanceItem({
  affordance,
  onNameCommit,
  onContentChange,
  onDelete,
}: {
  affordance: LocalAffordance;
  onNameCommit: (newName: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
}) {
  const [nameValue, setNameValue] = useState(affordance.name);
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
          value={nameValue}
          placeholder="affordance name"
          onChange={(e) => setNameValue(e.target.value.replace(/\s/g, "-"))}
          onBlur={() => {
            const v = slugify(nameValue);
            setNameValue(v);
            if (v && v !== affordance.savedName) onNameCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setNameValue(affordance.savedName);
              e.currentTarget.blur();
            }
          }}
        />
        <button className={styles.deleteBtn} onClick={onDelete} title="Delete affordance">×</button>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.contentArea}
        value={affordance.content}
        placeholder="what this affords…"
        onChange={(e) => { onContentChange(e.target.value); fitHeight(); }}
        onBlur={fitHeight}
      />
    </div>
  );
}

export function AffordanceEditor({ sigilPath, affordances, onReload }: AffordanceEditorProps) {
  const [items, setItems] = useState<LocalAffordance[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setItems(affordances.map((a) => ({ savedName: a.name, name: a.name, content: a.content })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigilPath]);

  const scheduleSave = useCallback((name: string, content: string) => {
    clearTimeout(saveTimers.current[name]);
    saveTimers.current[name] = setTimeout(() => {
      api.writeFile(`${sigilPath}/affordance-${name}.md`, content).catch(console.error);
    }, 400);
  }, [sigilPath]);

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
      await api.deleteFile(`${sigilPath}/affordance-${savedName}.md`).catch(console.error);
    }
    await api.writeFile(`${sigilPath}/affordance-${slugged}.md`, item.content).catch(console.error);
    setItems((prev) => prev.map((a) => a.savedName === savedName ? { ...a, savedName: slugged, name: slugged } : a));
    await onReload();
  }, [items, sigilPath, onReload]);

  const handleDelete = useCallback(async (savedName: string) => {
    if (savedName) {
      await api.deleteFile(`${sigilPath}/affordance-${savedName}.md`).catch(console.error);
    }
    setItems((prev) => prev.filter((a) => a.savedName !== savedName));
    if (savedName) await onReload();
  }, [sigilPath, onReload]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { savedName: "", name: "", content: "" }]);
    setCollapsed(false);
  }, []);

  return (
    <div className={styles.editor}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "▶" : "▼"}</span>
        <span className={styles.title}>Affordances</span>
        {collapsed && items.length > 0 && (
          <div className={styles.chips}>
            {items.map((item, i) => (
              <AffordanceChip key={item.savedName || `new-${i}`} item={item} />
            ))}
          </div>
        )}
        <button
          className={styles.addBtn}
          onClick={(e) => { e.stopPropagation(); handleAdd(); }}
          title="Add affordance"
        >+</button>
      </div>
      {!collapsed && items.length > 0 && (
        <div className={styles.list}>
          {items.map((item, i) => (
            <AffordanceItem
              key={item.savedName || `new-${i}`}
              affordance={item}
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
