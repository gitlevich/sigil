import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { api, Context } from "../../tauri";
import { RenamePopup } from "../shared/RenamePopup";
import { RefsDropdown } from "../shared/RefsDropdown";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import {
  SiblingInfo,
  buildSiblingHighlighter,
  buildPropertyExtensions,
  buildCollapsibleFrontmatter,
  getThemeExtension,
  PropertyEditorCallbacks,
} from "./sigilExtensions";
import styles from "./SigilPropertyEditor.module.css";

// ── Cross-panel drag source (global, like OntologyEditor's dragSourcePath) ──

export interface DragPropertySource {
  kind: "affordance" | "invariant";
  name: string;
  content: string;
  sourcePath: string;
}

let dragPropertySource: DragPropertySource | null = null;

export function getDragPropertySource(): DragPropertySource | null {
  return dragPropertySource;
}

export function clearDragPropertySource(): void {
  dragPropertySource = null;
}

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
  // Context for autocomplete / highlighting
  siblings?: SiblingInfo[];
  siblingNames?: string[];
  sigilRoot?: Context;
  currentContext?: Context;
  currentPath?: string[];
  onCreateAffordance?: (name: string) => void;
  onCreateInvariant?: (name: string) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onRenameProperty?: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onNavigateToSigil?: (name: string) => void;
  onNavigateToAbsPath?: (path: string[]) => void;
  keybindings?: Record<string, string>;
  actionDeps?: ActionDeps;
}

function CollapsedChips({ items, refPrefix, color }: { items: LocalItem[]; refPrefix: string; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth);
  }, [items]);

  return (
    <div
      className={styles.chips}
      ref={containerRef}
      style={{ "--property-color": color } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {items.map((item) => (
        <span key={item.id} className={styles.chip}>
          {refPrefix}{item.name || "..."}
        </span>
      ))}
      {overflowing && <span className={styles.chipsOverflow}>...</span>}
      {hovered && overflowing && (
        <div className={styles.chipsTooltip}>
          {items.map((item) => `${refPrefix}${item.name || "..."}`).join("  ")}
        </div>
      )}
    </div>
  );
}

// ── Mini CodeMirror for property content ──

function PropertyCodeMirror({
  value,
  placeholder,
  onChange,
  onCommit,
  onRevert,
  siblings,
  siblingNames,
  sigilRoot,
  currentContext,
  currentPath,
  onCreateAffordance,
  onCreateInvariant,
  editorCallbacks,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onRevert: () => void;
  siblings?: SiblingInfo[];
  siblingNames?: string[];
  sigilRoot?: Context;
  currentContext?: Context;
  currentPath?: string[];
  onCreateAffordance?: (name: string) => void;
  onCreateInvariant?: (name: string) => void;
  editorCallbacks?: PropertyEditorCallbacks;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartRef = useRef(new Compartment());
  const siblingCompartRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onRevertRef = useRef(onRevert);
  onRevertRef.current = onRevert;
  const onCreateAffordanceRef = useRef(onCreateAffordance);
  onCreateAffordanceRef.current = onCreateAffordance;
  const onCreateInvariantRef = useRef(onCreateInvariant);
  onCreateInvariantRef.current = onCreateInvariant;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        tooltips({ parent: document.body }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        themeCompartRef.current.of(getThemeExtension()),
        siblingCompartRef.current.of(
          buildSiblingHighlighter(
            siblingNames ?? [],
            siblings ?? [],
            sigilRoot ?? null,
            currentContext ?? null,
            currentPath ?? [],
          )
        ),
        ...buildPropertyExtensions(
          onCreateAffordanceRef.current,
          onCreateInvariantRef.current,
          editorCallbacks,
        ),
        buildCollapsibleFrontmatter(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommitRef.current();
              return true;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRevertRef.current();
              return true;
            }
            return false;
          },
          blur: () => {
            onCommitRef.current();
            return false;
          },
        }),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            fontSize: "13px",
            backgroundColor: "transparent",
            color: "var(--text-primary)",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": {
            overflow: "hidden",
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          },
          ".cm-content": {
            padding: "4px 0",
            caretColor: "var(--text-primary)",
          },
          ".cm-line": { padding: "0" },
          ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
          ".cm-front-matter": {
            opacity: "0.45",
            fontSize: "0.8em",
            fontStyle: "italic",
            color: "var(--text-secondary)",
          },
          ".cm-frontmatter-collapsed": {
            opacity: "0.45",
            fontSize: "0.8em",
            fontStyle: "italic",
            color: "var(--text-secondary)",
            cursor: "pointer",
          },
          ".cm-selectionBackground": {
            backgroundColor: "var(--accent) !important",
            opacity: "0.3",
          },
          "&.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--accent) !important",
            opacity: "0.3",
          },
        }),
        EditorView.contentAttributes.of({ "aria-placeholder": placeholder }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Update sibling highlighting
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: siblingCompartRef.current.reconfigure(
        buildSiblingHighlighter(
          siblingNames ?? [],
          siblings ?? [],
          sigilRoot ?? null,
          currentContext ?? null,
          currentPath ?? [],
        )
      ),
    });
  }, [siblingNames, siblings, sigilRoot, currentContext, currentPath]);

  // Watch for theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: themeCompartRef.current.reconfigure(getThemeExtension()) });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className={styles.contentArea} />;
}

// ── Property item ──

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
  isMaximized,
  onMaximizeToggle,
  propertyKind,
  sigilPath,
  onDragStart,
  onDragOver,
  onDrop,
  siblings,
  siblingNames,
  sigilRoot,
  currentContext,
  currentPath,
  onCreateAffordance,
  onCreateInvariant,
  editorCallbacks,
}: {
  item: LocalItem;
  color: string;
  namePlaceholder: string;
  contentPlaceholder: string;
  isDragOver: boolean;
  isFolded: boolean;
  isMaximized: boolean;
  propertyKind: "affordance" | "invariant";
  sigilPath: string;
  onNameCommit: (newName: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onFoldToggle: () => void;
  onMaximizeToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  siblings?: SiblingInfo[];
  siblingNames?: string[];
  sigilRoot?: Context;
  currentContext?: Context;
  currentPath?: string[];
  onCreateAffordance?: (name: string) => void;
  onCreateInvariant?: (name: string) => void;
  editorCallbacks?: PropertyEditorCallbacks;
}) {
  const [nameValue, setNameValue] = useState(item.name);
  const [pendingDelete, setPendingDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentBeforeEdit = useRef(item.content);

  return (
    <div
      className={`${styles.item} ${isDragOver ? styles.itemDragOver : ""} ${isMaximized ? styles.itemMaximized : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <span
        className={styles.dragHandle}
        title="Drag to reorder or move to another sigil"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart();
          if (item.savedName) {
            dragPropertySource = { kind: propertyKind, name: item.savedName, content: item.content, sourcePath: sigilPath };
          }
        }}
        onDragEnd={() => { dragPropertySource = null; }}
      >&#x283F;</span>
      <div className={styles.itemBody}>
      <div className={`${styles.itemHeader} ${isFolded ? styles.itemHeaderFolded : ""}`}>
        <button className={styles.foldBtn} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onFoldToggle(); }} title="Toggle fold">
          {isFolded ? "\u25B6" : "\u25BC"}
        </button>
        <button className={styles.maximizeBtn} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onMaximizeToggle(); }} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="10" height="10" rx="1"/>
              <path d="M1 4.5H4.5V1M11 7.5H7.5V11"/>
              <path d="M4.5 4.5L1 1M7.5 7.5L11 11"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="10" height="10" rx="1"/>
              <path d="M4.5 1V4.5H1M7.5 11V7.5H11"/>
              <path d="M1 1L4.5 4.5M11 11L7.5 7.5"/>
            </svg>
          )}
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
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setNameValue(item.savedName);
              e.currentTarget.blur();
            }
          }}
        />
        <button
          className={`${styles.deleteBtn} ${pendingDelete ? styles.deleteBtnConfirm : ""}`}
          tabIndex={-1}
          onClick={() => {
            if (pendingDelete) {
              if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
              setPendingDelete(false);
              onDelete();
            } else {
              setPendingDelete(true);
              deleteTimerRef.current = setTimeout(() => setPendingDelete(false), 2000);
            }
          }}
          onBlur={() => { setPendingDelete(false); if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }}
          title={pendingDelete ? "Click again to confirm" : `Delete ${namePlaceholder}`}
        >{pendingDelete ? "?" : "x"}</button>
      </div>
      {!isFolded && (
        <PropertyCodeMirror
          value={item.content}
          placeholder={contentPlaceholder}
          onChange={onContentChange}
          onCommit={() => { contentBeforeEdit.current = item.content; }}
          onRevert={() => { onContentChange(contentBeforeEdit.current); }}
          siblings={siblings}
          siblingNames={siblingNames}
          sigilRoot={sigilRoot}
          currentContext={currentContext}
          currentPath={currentPath}
          onCreateAffordance={onCreateAffordance}
          onCreateInvariant={onCreateInvariant}
          editorCallbacks={editorCallbacks}
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
  siblings,
  siblingNames,
  sigilRoot,
  currentContext,
  currentPath,
  onCreateAffordance,
  onCreateInvariant,
  onRenameSigil,
  onRenameProperty,
  onNavigateToSigil,
  onNavigateToAbsPath,
  keybindings = {},
  actionDeps,
}: SigilPropertyEditorProps) {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [foldedItems, setFoldedItems] = useState<Set<string>>(new Set());
  const [maximizedItem, setMaximizedItem] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [renameState, setRenameState] = useState<{ oldName: string; x: number; y: number; kind: "sigil" | "affordance" | "invariant" } | null>(null);
  const [refsState, setRefsState] = useState<{ hits: { contextName: string; contextPath: string[]; line: string }[]; x: number; y: number } | null>(null);
  const dragSourceIndex = useRef<number | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingWrites = useRef<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const editorCallbacks: PropertyEditorCallbacks = {
    onCreateAffordance,
    onCreateInvariant,
    onRenameSigil,
    onRenameProperty,
    onNavigateToSigil,
    onNavigateToAbsPath,
    keybindings,
    onRenameStart: (target) => setRenameState(target),
    onFindReferences: (hits, x, y) => { setRefsState({ hits, x, y }); },
  };

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
    if (!actionDeps) return;
    const names = ordered.map((i) => i.savedName).filter(Boolean);
    actions.savePropertyOrder(sigilPath, filePrefix, names, actionDeps);
  }, [sigilPath, filePrefix, actionDeps]);

  const saveFold = useCallback((folded: Set<string>) => {
    if (!actionDeps) return;
    actions.savePropertyFold(sigilPath, filePrefix, [...folded], actionDeps);
  }, [sigilPath, filePrefix, actionDeps]);

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
    if (!actionDeps) return;
    clearTimeout(saveTimers.current[name]);
    pendingWrites.current[name] = content;
    saveTimers.current[name] = setTimeout(() => {
      delete pendingWrites.current[name];
      actions.savePropertyContent(sigilPath, filePrefix, name, content, actionDeps);
    }, 400);
  }, [sigilPath, filePrefix, actionDeps]);

  // Flush all pending property saves on unmount
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
      const pending = pendingWrites.current;
      for (const [name, content] of Object.entries(pending)) {
        actions.savePropertyContent(sigilPath, filePrefix, name, content, actionDeps!);
      }
      pendingWrites.current = {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigilPath, filePrefix]);

  const handleContentChange = useCallback((savedName: string, content: string) => {
    setItems((prev) => prev.map((a) => a.savedName === savedName ? { ...a, content } : a));
    if (savedName) scheduleSave(savedName, content);
  }, [scheduleSave]);

  const handleNameCommit = useCallback(async (savedName: string, newName: string) => {
    if (!actionDeps) return;
    const slugged = slugify(newName);
    if (!slugged) return;
    const item = items.find((a) => a.savedName === savedName);
    if (!item) return;
    await actions.commitPropertyName(sigilPath, filePrefix, savedName, slugged, item.content, actionDeps);
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
  }, [items, sigilPath, filePrefix, actionDeps, saveOrder, saveFold]);

  const handleDelete = useCallback(async (savedName: string) => {
    if (savedName && actionDeps) {
      await actions.deleteProperty(sigilPath, filePrefix, savedName, actionDeps);
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
    }
  }, [sigilPath, filePrefix, actionDeps, saveOrder, saveFold]);

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
    <div ref={listRef} className={`${styles.editor} ${maximizedItem ? styles.editorMaximized : ""}`} style={{ "--property-color": color } as React.CSSProperties}>
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggleIcon}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={styles.title}>{title}</span>
        {collapsed && items.length > 0 && (
          <CollapsedChips items={items} refPrefix={refPrefix} color={color} />
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
        <div className={`${styles.list} ${maximizedItem ? styles.listMaximized : ""}`}>
          {items.map((item, i) => {
            if (maximizedItem && item.id !== maximizedItem) return null;
            return (
              <PropertyItem
                key={item.id}
                item={item}
                color={color}
                namePlaceholder={namePlaceholder}
                contentPlaceholder={contentPlaceholder}
                isDragOver={dragOverIndex === i}
                isFolded={maximizedItem ? false : foldedItems.has(item.savedName)}
                isMaximized={maximizedItem === item.id}
                propertyKind={filePrefix as "affordance" | "invariant"}
                sigilPath={sigilPath}
                onContentChange={(c) => handleContentChange(item.savedName, c)}
                onNameCommit={(n) => handleNameCommit(item.savedName, n)}
                onDelete={() => handleDelete(item.savedName)}
                onFoldToggle={() => toggleItemFold(item.savedName)}
                onMaximizeToggle={() => setMaximizedItem((prev) => prev === item.id ? null : item.id)}
                onDragStart={() => { dragSourceIndex.current = i; }}
                onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
                onDrop={() => handleDrop(i)}
                siblings={siblings}
                siblingNames={siblingNames}
                sigilRoot={sigilRoot}
                currentContext={currentContext}
                currentPath={currentPath}
                onCreateAffordance={onCreateAffordance}
                onCreateInvariant={onCreateInvariant}
                editorCallbacks={editorCallbacks}
              />
            );
          })}
        </div>
      )}
      {renameState && (
        <RenamePopup
          oldName={renameState.oldName}
          kind={renameState.kind}
          x={renameState.x}
          y={renameState.y}
          onRename={(kind, oldName, newName) => {
            if (kind === "sigil" && onRenameSigil) onRenameSigil(oldName, newName);
            else if ((kind === "affordance" || kind === "invariant") && onRenameProperty) onRenameProperty(kind, oldName, newName);
          }}
          onClose={() => setRenameState(null)}
        />
      )}
      {refsState && (
        <RefsDropdown
          hits={refsState.hits}
          x={refsState.x}
          y={refsState.y}
          onNavigate={(path) => { if (onNavigateToAbsPath) onNavigateToAbsPath(path); }}
          onClose={() => setRefsState(null)}
        />
      )}
    </div>
  );
}
