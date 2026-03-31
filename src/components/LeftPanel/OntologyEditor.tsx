import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useSigil } from "../../hooks/useSigil";
import styles from "./OntologyEditor.module.css";

let dragSourcePath: string | null = null;

interface OntologyNode {
  name: string;
  path: string[];
  fsPath: string;
  depth: number;
  children: OntologyNode[];
}

interface ContextMenuState {
  x: number;
  y: number;
  node: OntologyNode;
}

function buildOntology(ctx: Context, path: string[], depth: number): OntologyNode {
  return {
    name: ctx.name,
    path,
    fsPath: ctx.path,
    depth,
    children: ctx.children.map((c) => buildOntology(c, [...path, c.name], depth + 1)),
  };
}

function nodeMatches(node: OntologyNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  return node.children.some((c) => nodeMatches(c, query));
}

function pathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function flattenPaths(node: OntologyNode): string[][] {
  const result: string[][] = [node.path];
  for (const child of node.children) result.push(...flattenPaths(child));
  return result;
}

function parseDefinitions(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const sections = content.split(/^## /m);
  for (const section of sections.slice(1)) {
    const nl = section.indexOf("\n");
    if (nl === -1) continue;
    result[section.slice(0, nl).trim()] = section.slice(nl + 1).trim();
  }
  return result;
}

function serializeDefinitions(defs: Record<string, string>): string {
  const entries = Object.entries(defs).filter(([, v]) => v.trim());
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `## ${k}\n\n${v.trim()}`).join("\n\n") + "\n";
}

function InlinePeerInput({
  parentFsPath,
  onSubmit,
  onAbort,
}: {
  parentFsPath: string;
  onSubmit: () => void;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = async () => {
    const name = value.trim();
    if (!name) { onAbort(); return; }
    await api.createContext(parentFsPath, name).catch(console.error);
    onSubmit();
  };

  return (
    <div className={styles.peerInputRow}>
      <span className={styles.chevronPlaceholder} />
      <input
        ref={inputRef}
        className={styles.peerInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="name..."
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onAbort(); }
        }}
        onBlur={onAbort}
      />
    </div>
  );
}

function OntologyItem({
  node,
  currentPath,
  search,
  definitions,
  addingPeerAfterPath,
  onNavigate,
  onDefinitionChange,
  onContextMenu,
  onDrop,
  onPeerSubmit,
  onPeerAbort,
}: {
  node: OntologyNode;
  currentPath: string[];
  search: string;
  definitions: Record<string, string>;
  addingPeerAfterPath: string[] | null;
  onNavigate: (path: string[]) => void;
  onDefinitionChange: (name: string, value: string) => void;
  onContextMenu: (e: React.MouseEvent, node: OntologyNode) => void;
  onDrop: (sourceFsPath: string, targetFsPath: string) => void;
  onPeerSubmit: () => void;
  onPeerAbort: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const isActive = pathsEqual(currentPath, node.path);
  const forceExpand = search.length > 0 && node.children.some((c) => nodeMatches(c, search));
  const [expanded, setExpanded] = useState(true);
  const [defOpen, setDefOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const open = forceExpand || expanded;
  const atLimit = node.children.length >= 5;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const defKey = node.path.join("/");

  const fitHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    if (defOpen) fitHeight();
  }, [defOpen, definitions[defKey]]);

  const visibleChildren = search
    ? node.children.filter((c) => nodeMatches(c, search))
    : node.children;

  return (
    <div
      className={styles.item}
      onDragOver={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (!atLimit) { e.dataTransfer.dropEffect = "move"; setDropTarget(true); }
        else e.dataTransfer.dropEffect = "none";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(false);
      }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        setDropTarget(false);
        const src = dragSourcePath; dragSourcePath = null;
        if (!src || src === node.fsPath || node.fsPath.startsWith(src + "/")) return;
        onDrop(src, node.fsPath);
      }}
    >
      <div
        className={`${styles.row} ${isActive ? styles.active : ""} ${dropTarget ? styles.dropTarget : ""}`}
        draggable={node.path.length > 0}
        onDragStart={(e) => { e.stopPropagation(); dragSourcePath = node.fsPath; e.dataTransfer.effectAllowed = "move"; }}
        onClick={() => onNavigate(node.path)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, node); }}
      >
        {hasChildren ? (
          <button
            className={styles.chevron}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {open ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}
        <span className={styles.term}>{node.name}</span>
        <button
          className={`${styles.defBtn} ${defOpen ? styles.defBtnOpen : ""} ${!defOpen && definitions[defKey]?.trim() ? styles.defBtnDefined : ""}`}
          onClick={(e) => { e.stopPropagation(); setDefOpen(!defOpen); }}
        >
          ¶
        </button>
      </div>

      {defOpen && (
        <div className={styles.defArea}>
          <textarea
            ref={textareaRef}
            className={styles.defTextarea}
            value={definitions[defKey] ?? ""}
            placeholder="Definition..."
            onChange={(e) => onDefinitionChange(defKey, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textareaRef.current?.blur(); } }}
            onBlur={fitHeight}
          />
        </div>
      )}

      {open && visibleChildren.length > 0 && (
        <div className={styles.children}>
          {visibleChildren.map((child) => (
            <div key={child.name}>
              <OntologyItem
                node={child}
                currentPath={currentPath}
                search={search}
                definitions={definitions}
                addingPeerAfterPath={addingPeerAfterPath}
                onNavigate={onNavigate}
                onDefinitionChange={onDefinitionChange}
                onContextMenu={onContextMenu}
                onDrop={onDrop}
                onPeerSubmit={onPeerSubmit}
                onPeerAbort={onPeerAbort}
              />
              {addingPeerAfterPath && pathsEqual(child.path, addingPeerAfterPath) && (
                <InlinePeerInput
                  parentFsPath={node.fsPath}
                  onSubmit={onPeerSubmit}
                  onAbort={onPeerAbort}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OntologyEditor() {
  const doc = useDocument();
  const dispatch = useAppDispatch();
  const { reload } = useSigil();
  const { save } = useAutoSave();
  const [search, setSearch] = useState("");
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ fsPath: string; name: string } | null>(null);
  const [addingPeerOf, setAddingPeerOf] = useState<string[] | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const ontologyPath = doc ? `${doc.sigil.root_path}/ontology.md` : "";

  useEffect(() => {
    if (!doc) return;
    api.readFile(`${doc.sigil.root_path}/ontology.md`)
      .then((text) => setDefinitions(parseDefinitions(text)))
      .catch(() => setDefinitions({}));
  }, [doc?.sigil.root_path]);

  useEffect(() => {
    const hide = () => setContextMenu(null);
    if (contextMenu) { document.addEventListener("click", hide); return () => document.removeEventListener("click", hide); }
  }, [contextMenu]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!doc?.renamingRequest) return;
    dispatch({ type: "UPDATE_DOCUMENT", updates: { renamingRequest: false } });
    const node = findNodeByPath(buildOntology(doc.sigil.root, [], 0), doc.currentPath);
    if (node) setRenaming({ fsPath: node.fsPath, name: node.name });
  }, [doc?.renamingRequest]);

  const handleDefinitionChange = useCallback((name: string, value: string) => {
    setDefinitions((prev) => {
      const next = { ...prev, [name]: value };
      if (ontologyPath) save(ontologyPath, serializeDefinitions(next));
      return next;
    });
  }, [ontologyPath, save]);

  const handleMove = async (sourceFsPath: string, targetFsPath: string) => {
    if (!doc) return;
    try { await api.moveSigil(doc.sigil.root_path, sourceFsPath, targetFsPath); await reload(doc.sigil.root_path); }
    catch (err) { console.error("Move failed:", err); }
  };

  const handleRename = async (fsPath: string, oldName: string, newName: string) => {
    if (!doc) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setRenaming(null); return; }
    try { await api.renameSigil(doc.sigil.root_path, fsPath, trimmed); await reload(doc.sigil.root_path); }
    catch (err) { console.error("Rename failed:", err); }
    setRenaming(null);
  };

  const handleDelete = async (node: OntologyNode) => {
    if (!confirm(`Delete "${node.name}" and all its contents? This cannot be undone.`)) return;
    try { await api.deleteContext(node.fsPath); await reload(doc!.sigil.root_path); }
    catch (err) { console.error("Delete failed:", err); }
  };

  const handlePeerSubmit = async () => {
    if (!doc) return;
    await reload(doc.sigil.root_path);
    setAddingPeerOf(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || addingPeerOf) return;
    if (!doc) return;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const root = buildOntology(doc.sigil.root, [], 0);
      const all = flattenPaths(root);
      const idx = all.findIndex((p) => pathsEqual(p, doc.currentPath));
      if (e.key === "ArrowUp" && idx > 0) dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: all[idx - 1] } });
      if (e.key === "ArrowDown" && idx < all.length - 1) dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: all[idx + 1] } });
      return;
    }

    if (e.key === "Enter" && e.shiftKey && doc.currentPath.length > 0) {
      e.preventDefault();
      setAddingPeerOf(doc.currentPath);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && doc.currentPath.length > 0) {
      e.preventDefault();
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: doc.currentPath } });
    }
  };

  if (!doc) return null;

  const root = buildOntology(doc.sigil.root, [], 0);
  const query = search.toLowerCase().trim();
  const rootVisible = !query || nodeMatches(root, query);

  const sharedProps = {
    currentPath: doc.currentPath,
    search: query,
    definitions,
    addingPeerAfterPath: addingPeerOf,
    onNavigate: (path: string[]) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } }),
    onDefinitionChange: handleDefinitionChange,
    onContextMenu: (e: React.MouseEvent, node: OntologyNode) => setContextMenu({ x: e.clientX, y: e.clientY, node }),
    onDrop: handleMove,
    onPeerSubmit: handlePeerSubmit,
    onPeerAbort: () => setAddingPeerOf(null),
  };

  return (
    <div
      ref={containerRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search ontology..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.tree}>
        {rootVisible && (
          <>
            <div
              className={`${styles.row} ${doc.currentPath.length === 0 ? styles.active : ""}`}
              onClick={() => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: [] } })}
            >
              <span className={styles.chevronPlaceholder} />
              <span className={styles.term}>{root.name}</span>
            </div>
            <div className={styles.children}>
              {root.children
                .filter((c) => !query || nodeMatches(c, query))
                .map((child) => (
                  <div key={child.name}>
                    <OntologyItem node={child} {...sharedProps} />
                    {addingPeerOf && pathsEqual(child.path, addingPeerOf) && (
                      <InlinePeerInput
                        parentFsPath={root.fsPath}
                        onSubmit={handlePeerSubmit}
                        onAbort={() => setAddingPeerOf(null)}
                      />
                    )}
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className={styles.menuItem} onClick={() => { setRenaming({ fsPath: contextMenu.node.fsPath, name: contextMenu.node.name }); setContextMenu(null); }}>Rename</button>
          <button className={styles.menuItem} onClick={() => { api.revealInFinder(contextMenu.node.fsPath).catch(console.error); setContextMenu(null); }}>Open in Finder</button>
          {contextMenu.node.path.length > 0 && (
            <button className={styles.menuItemDanger} onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }}>Delete</button>
          )}
        </div>
      )}

      {renaming && (
        <div className={styles.renameOverlay}>
          <div className={styles.renameDialog}>
            <label className={styles.renameLabel}>Rename to:</label>
            <input
              ref={renameInputRef}
              className={styles.renameInput}
              defaultValue={renaming.name}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(renaming.fsPath, renaming.name, e.currentTarget.value);
                if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
              }}
              onBlur={(e) => handleRename(renaming.fsPath, renaming.name, e.currentTarget.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function findNodeByPath(root: OntologyNode, path: string[]): OntologyNode | null {
  if (path.length === 0) return root;
  const child = root.children.find((c) => c.name === path[0]);
  return child ? findNodeByPath(child, path.slice(1)) : null;
}
