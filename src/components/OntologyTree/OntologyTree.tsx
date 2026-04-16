import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  useWorkspaceState, useWorkspaceDispatch, useWorkspaceActions,
} from "../../state/WorkspaceContext";
import { api, SigilFolder } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useToast } from "../../hooks/useToast";
import { useActionDeps } from "../../hooks/useActionDeps";
import { getDragPropertySource, clearDragPropertySource } from "../Workspace/SigilPropertyEditor";
import { findAllReferencesInTree } from "../Workspace/editorScope";
import { RefsDropdown } from "../shared/RefsDropdown";
import type { RefHit } from "../shared/RefsDropdown";
import { useMouseDrag } from "../../hooks/useMouseDrag";
import type { DragState } from "../../hooks/useMouseDrag";
import * as actions from "../../actions/workspace";
import type { ActionDeps } from "../../actions/workspace";
import styles from "./OntologyTree.module.css";

export interface OntologyNode {
  name: string;
  path: string[];
  fsPath: string;
  depth: number;
  affordances: string[];
  invariants: string[];
  children: OntologyNode[];
  isImported: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: OntologyNode;
}

export function buildOntology(folder: SigilFolder, path: string[], depth: number): OntologyNode {
  return {
    name: folder.name,
    path,
    fsPath: folder.path,
    depth,
    affordances: folder.affordances.map((a) => a.name),
    invariants: folder.invariants.map((c) => c.name),
    children: folder.children.map((c) => buildOntology(c, [...path, c.name], depth + 1)),
    isImported: folder.isImported ?? false,
  };
}

export function nodeMatches(node: OntologyNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  return node.children.some((c) => nodeMatches(c, query));
}

export function pathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function flattenPaths(node: OntologyNode): string[][] {
  const result: string[][] = [node.path];
  for (const child of node.children) result.push(...flattenPaths(child));
  return result;
}

export function flattenNodes(node: OntologyNode): OntologyNode[] {
  return [node, ...node.children.flatMap(flattenNodes)];
}

/** Check if a drag source can be dropped onto a target. Exported for testing. */
export function canDropOnNode(src: string, target: string, allNodes: OntologyNode[]): boolean {
  if (src === target) return false;
  if (target.startsWith(src + "/")) return false;
  const targetNode = allNodes.find(n => n.fsPath === target);
  if (!targetNode) return false;
  return true;
}

/** Density band for child count. Green up to 5, yellow 6-8, red 9+. */
export function childCountBand(n: number): "green" | "yellow" | "red" | null {
  if (n <= 0) return null;
  if (n <= 5) return "green";
  if (n <= 8) return "yellow";
  return "red";
}

async function loadDefinitions(root: OntologyNode): Promise<Record<string, string>> {
  const nodes = flattenNodes(root);
  const entries = await Promise.all(
    nodes.map(async (n) => {
      const text = await api.readFile(`${n.fsPath}/definition.md`).catch(() => "");
      return [n.fsPath, text.trim()] as [string, string];
    })
  );
  return Object.fromEntries(entries.filter(([, v]) => v));
}

function InlinePeerInput({
  parentFsPath,
  onSubmit,
  onAbort,
  actionDeps,
}: {
  parentFsPath: string;
  onSubmit: () => void;
  onAbort: () => void;
  actionDeps: ActionDeps;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = async () => {
    const name = value.trim();
    if (!name) { onAbort(); return; }
    await actions.createContext(parentFsPath, name, actionDeps);
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

/** Suppresses click navigation after a property drop completes on a tree node. */
let propertyDropJustHappened = false;

function pathKey(path: string[]): string {
  return path.join("/");
}

function OntologyItem({
  node,
  currentPath,
  search,
  definitions,
  addingPeerAfterPath,
  collapsedPaths,
  dragState,
  propertyDropTarget,
  onNavigate,
  onDefinitionChange,
  onContextMenu,
  onDragStart,
  onTargetEnter,
  onTargetLeave,
  onTargetDrop,
  onPropertyTargetEnter,
  onPropertyTargetLeave,
  onPropertyDrop,
  onPeerSubmit,
  onPeerAbort,
  onToggleCollapse,
  actionDeps,
}: {
  node: OntologyNode;
  currentPath: string[];
  search: string;
  definitions: Record<string, string>;
  addingPeerAfterPath: string[] | null;
  collapsedPaths: Set<string>;
  dragState: DragState;
  propertyDropTarget: string | null;
  onNavigate: (path: string[]) => void;
  onDefinitionChange: (fsPath: string, value: string) => void;
  onContextMenu: (e: React.MouseEvent, node: OntologyNode) => void;
  onDragStart: (e: React.MouseEvent, fsPath: string) => void;
  onTargetEnter: (fsPath: string) => void;
  onTargetLeave: (fsPath: string) => void;
  onTargetDrop: (fsPath: string) => void;
  onPropertyTargetEnter: (fsPath: string) => void;
  onPropertyTargetLeave: (fsPath: string) => void;
  onPropertyDrop: (targetFsPath: string, source: { kind: "affordance" | "invariant"; name: string; content: string; sourcePath: string }) => void;
  onPeerSubmit: () => void;
  onPeerAbort: () => void;
  onToggleCollapse: (path: string[]) => void;
  actionDeps: ActionDeps;
}) {
  const hasChildren = node.children.length > 0;
  const isActive = pathsEqual(currentPath, node.path);
  const forceExpand = search.length > 0 && node.children.some((c) => nodeMatches(c, search));
  const expanded = !collapsedPaths.has(pathKey(node.path));
  const [defOpen, setDefOpen] = useState(false);
  const open = forceExpand || expanded;
  const isDropTarget = dragState.targetPath === node.fsPath || propertyDropTarget === node.fsPath;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  const fitHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    if (defOpen) fitHeight();
  }, [defOpen, definitions[node.fsPath]]);

  const visibleChildren = search
    ? node.children.filter((c) => nodeMatches(c, search))
    : node.children;

  return (
    <div className={styles.item}>
      <div
        ref={rowRef}
        className={`${styles.row} ${isActive ? styles.active : ""} ${isDropTarget ? styles.dropTarget : ""}`}
        onMouseDown={(e) => { if (node.path.length > 0) onDragStart(e, node.fsPath); }}
        onMouseEnter={() => {
          if (dragState.sourcePath) onTargetEnter(node.fsPath);
          if (getDragPropertySource()) onPropertyTargetEnter(node.fsPath);
        }}
        onMouseLeave={() => {
          if (dragState.sourcePath) onTargetLeave(node.fsPath);
          if (getDragPropertySource()) onPropertyTargetLeave(node.fsPath);
        }}
        onMouseUp={() => {
          if (dragState.sourcePath) onTargetDrop(node.fsPath);
          const propSrc = getDragPropertySource();
          if (propSrc) {
            clearDragPropertySource();
            propertyDropJustHappened = true;
            setTimeout(() => { propertyDropJustHappened = false; }, 0);
            onPropertyDrop(node.fsPath, propSrc);
          }
        }}
        onClick={() => { if (!dragState.sourcePath && !propertyDropJustHappened) onNavigate(node.path); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, node); }}
      >
        {hasChildren ? (
          <button
            className={styles.chevron}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.path); }}
          >
            {open ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}
        <span className={`${styles.term} ${node.isImported ? styles.imported : ""}`}>{node.name}</span>
        {(() => {
          const band = childCountBand(node.children.length);
          if (!band) return null;
          return (
            <span className={`${styles.count} ${styles[`count_${band}`]}`}>
              ({node.children.length})
            </span>
          );
        })()}
        <button
          className={`${styles.defBtn} ${defOpen ? styles.defBtnOpen : ""} ${!defOpen && definitions[node.fsPath]?.trim() ? styles.defBtnDefined : ""}`}
          onClick={(e) => { e.stopPropagation(); setDefOpen(!defOpen); }}
        >
          ¶
        </button>
      </div>

      {(node.invariants.length > 0 || node.affordances.length > 0) && (
        <div className={styles.propertyList}>
          {node.invariants.map((name) => (
            <span key={`d-${name}`} className={styles.iconWrap} title={`!${name}`}>
              <svg width="6" height="13" viewBox="0 0 6 13">
                <line x1="3" y1="1" x2="3" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="3" cy="4.5" r="2" fill="#f40009" />
              </svg>
            </span>
          ))}
          {node.affordances.map((name) => (
            <span key={`a-${name}`} className={styles.iconWrap} title={`#${name}`}>
              <svg width="12" height="12" viewBox="0 0 14 14">
                <rect x="2" y="2" width="4" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 7 L11 7 L12 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}
        </div>
      )}

      {defOpen && (
        <div className={styles.defArea}>
          <textarea
            ref={textareaRef}
            className={styles.defTextarea}
            value={definitions[node.fsPath] ?? ""}
            placeholder="Definition..."
            onChange={(e) => onDefinitionChange(node.fsPath, e.target.value)}
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
                collapsedPaths={collapsedPaths}
                dragState={dragState}
                propertyDropTarget={propertyDropTarget}
                onNavigate={onNavigate}
                onDefinitionChange={onDefinitionChange}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
                onTargetEnter={onTargetEnter}
                onTargetLeave={onTargetLeave}
                onTargetDrop={onTargetDrop}
                onPropertyTargetEnter={onPropertyTargetEnter}
                onPropertyTargetLeave={onPropertyTargetLeave}
                onPropertyDrop={onPropertyDrop}
                onPeerSubmit={onPeerSubmit}
                onPeerAbort={onPeerAbort}
                onToggleCollapse={onToggleCollapse}
                actionDeps={actionDeps}
              />
              {addingPeerAfterPath && pathsEqual(child.path, addingPeerAfterPath) && (
                <InlinePeerInput
                  parentFsPath={node.fsPath}
                  onSubmit={onPeerSubmit}
                  onAbort={onPeerAbort}
                  actionDeps={actionDeps}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OntologyTree() {
  const ws = useWorkspaceState();
  const wsDispatch = useWorkspaceDispatch();
  const { navigate, reload } = useWorkspaceActions();
  const { save } = useAutoSave();
  const { addToast } = useToast();

  const actionDeps = useActionDeps();

  const [search, setSearch] = useState("");
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [refsState, setRefsState] = useState<{ hits: RefHit[]; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ fsPath: string; name: string } | null>(null);
  const [addingPeerOf, setAddingPeerOf] = useState<string[] | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const reloadDefinitions = useCallback(async (root: SigilFolder) => {
    const defs = await loadDefinitions(buildOntology(root, [], 0));
    setDefinitions(defs);
  }, []);

  useEffect(() => {
    reloadDefinitions(ws.spec.root);
  }, [ws.spec.rootPath]);

  useEffect(() => {
    const hide = () => setContextMenu(null);
    if (contextMenu) { document.addEventListener("click", hide); return () => document.removeEventListener("click", hide); }
  }, [contextMenu]);

  useLayoutEffect(() => {
    const el = contextMenuRef.current;
    if (!el || !contextMenu) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${Math.max(0, contextMenu.y - rect.height)}px`;
    }
    if (rect.right > window.innerWidth) {
      el.style.left = `${Math.max(0, contextMenu.x - rect.width)}px`;
    }
  }, [contextMenu]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const handleDefinitionChange = useCallback((fsPath: string, value: string) => {
    setDefinitions((prev) => ({ ...prev, [fsPath]: value }));
    save(`${fsPath}/definition.md`, value);
  }, [save]);

  const handleMove = useCallback(async (sourceFsPath: string, targetFsPath: string) => {
    await actions.moveSigil(sourceFsPath, targetFsPath, actionDeps);
    const spec = await reload();
    if (spec) await reloadDefinitions(spec.root);
  }, [actionDeps, reload, reloadDefinitions]);

  const allNodesRef = useRef<OntologyNode[]>([]);

  const canDrop = useCallback((src: string, target: string) => {
    return canDropOnNode(src, target, allNodesRef.current);
  }, []);

  const { dragState, onDragStart, onTargetEnter, onTargetLeave, onTargetDrop } = useMouseDrag({
    onDrop: handleMove,
    canDrop,
  });

  const [propertyDropTarget, setPropertyDropTarget] = useState<string | null>(null);

  const handlePropertyTargetEnter = useCallback((fsPath: string) => {
    setPropertyDropTarget(fsPath);
  }, []);

  const handlePropertyTargetLeave = useCallback((fsPath: string) => {
    setPropertyDropTarget(prev => prev === fsPath ? null : prev);
  }, []);

  const handlePropertyDrop = async (targetFsPath: string, src: { kind: "affordance" | "invariant"; name: string; content: string; sourcePath: string }) => {
    setPropertyDropTarget(null);
    await actions.moveProperty(targetFsPath, src, actionDeps);
    const spec = await reload();
    if (spec) await reloadDefinitions(spec.root);
  };

  const handleRename = async (fsPath: string, oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setRenaming(null); return; }
    await actions.renameSigil(fsPath, trimmed, actionDeps);
    const spec = await reload();
    if (spec) await reloadDefinitions(spec.root);
    setRenaming(null);
  };

  const handleDelete = async (node: OntologyNode) => {
    if (!await confirm(`Delete "${node.name}" and all its contents? This cannot be undone.`)) return;
    await actions.deleteSigil(node.fsPath, actionDeps);
  };

  const handlePeerSubmit = async () => {
    await reload();
    setAddingPeerOf(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || addingPeerOf) return;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const root = buildOntology(ws.spec.root, [], 0);
      const all = flattenPaths(root);
      const idx = all.findIndex((p) => pathsEqual(p, ws.currentPath));
      if (e.key === "ArrowUp" && idx > 0) navigate(all[idx - 1]);
      if (e.key === "ArrowDown" && idx < all.length - 1) navigate(all[idx + 1]);
      return;
    }

    if (e.key === "Enter" && e.shiftKey && ws.currentPath.length > 0) {
      e.preventDefault();
      setAddingPeerOf(ws.currentPath);
      return;
    }
  };

  const root = buildOntology(ws.spec.root, [], 0);
  const importedOntologies = ws.spec.importedOntologies
    ? buildOntology(ws.spec.importedOntologies, ["Imported Ontologies"], 0)
    : null;

  // Keep flat node list for canDrop lookups
  const allNodes = useMemo(() => {
    const nodes = flattenNodes(root);
    if (importedOntologies) nodes.push(...flattenNodes(importedOntologies));
    return nodes;
  }, [root, importedOntologies]);
  allNodesRef.current = allNodes;

  const query = search.toLowerCase().trim();
  const rootVisible = !query || nodeMatches(root, query);
  const importedVisible = importedOntologies && (!query || nodeMatches(importedOntologies, query));

  const collapsedSet = useMemo(() => new Set(ws.collapsedPaths), [ws.collapsedPaths]);

  const handleToggleCollapse = useCallback((path: string[]) => {
    const key = pathKey(path);
    wsDispatch({ type: "TOGGLE_COLLAPSE", pathKey: key });
  }, [wsDispatch]);

  const sharedProps = {
    currentPath: ws.currentPath,
    search: query,
    definitions,
    addingPeerAfterPath: addingPeerOf,
    collapsedPaths: collapsedSet,
    dragState,
    propertyDropTarget,
    onNavigate: (path: string[]) => navigate(path),
    onDefinitionChange: handleDefinitionChange,
    onContextMenu: (e: React.MouseEvent, node: OntologyNode) => setContextMenu({ x: e.clientX, y: e.clientY, node }),
    onDragStart,
    onTargetEnter,
    onTargetLeave,
    onTargetDrop,
    onPropertyTargetEnter: handlePropertyTargetEnter,
    onPropertyTargetLeave: handlePropertyTargetLeave,
    onPropertyDrop: handlePropertyDrop,
    onPeerSubmit: handlePeerSubmit,
    onPeerAbort: () => setAddingPeerOf(null),
    onToggleCollapse: handleToggleCollapse,
    actionDeps,
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${dragState.sourcePath ? styles.dragging : ""}`}
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
          <OntologyItem node={root} {...sharedProps} />
        )}
        {importedVisible && importedOntologies && (
          <OntologyItem node={importedOntologies} {...sharedProps} />
        )}
      </div>

      {contextMenu && (
        <div ref={contextMenuRef} className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className={styles.menuItem} onClick={() => { setRenaming({ fsPath: contextMenu.node.fsPath, name: contextMenu.node.name }); setContextMenu(null); }}>Rename</button>
          <button className={styles.menuItem} onClick={() => {
            const hits = findAllReferencesInTree(ws.spec.root, contextMenu.node.name, []);
            if (hits.length > 0) {
              setRefsState({ hits, x: contextMenu.x, y: contextMenu.y });
            } else {
              addToast(`No references to @${contextMenu.node.name} found`);
            }
            setContextMenu(null);
          }}>Find References</button>
          <button className={styles.menuItem} onClick={() => { api.revealInFinder(contextMenu.node.fsPath).catch(console.error); setContextMenu(null); }}>Open in Finder</button>
          <button className={styles.menuItem} onClick={() => { writeText(contextMenu.node.fsPath).catch(console.error); setContextMenu(null); }}>Copy Path</button>
          {contextMenu.node.path.length > 0 && (
            <button className={styles.menuItemDanger} onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }}>Delete</button>
          )}
        </div>
      )}

      {refsState && (
        <RefsDropdown
          hits={refsState.hits}
          x={refsState.x}
          y={refsState.y}
          onNavigate={(path) => navigate(path)}
          onClose={() => setRefsState(null)}
        />
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

