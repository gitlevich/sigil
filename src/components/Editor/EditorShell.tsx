import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppDispatch, useAppState, useDocument } from "../../state/AppContext";
import { LeftPanel } from "../LeftPanel/LeftPanel";
import { ChatPanel } from "../RightPanel/ChatPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor, SiblingInfo } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { Context, api, DEFAULT_KEYBINDINGS } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useSigil } from "../../hooks/useSigil";
import { useToast } from "../../hooks/useToast";
import { SigilMap } from "./Map";
import { SigilPropertyEditor } from "./SigilPropertyEditor";
import { buildBreadcrumb as coreBuildBreadcrumb, buildLexicalScope as coreBuildLexicalScope, makeSummary, resolveRefName } from "sigil-core";
import styles from "./EditorShell.module.css";

/** Match a browser KeyboardEvent against a CodeMirror key string (e.g. "Ctrl-1", "Alt-Mod-r"). */
function matchesBinding(e: KeyboardEvent, cmKey: string): boolean {
  const parts = cmKey.split("-");
  const keyChar = parts[parts.length - 1].toLowerCase();
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));

  const needsCtrl = mods.has("ctrl");
  const needsMod = mods.has("mod");
  const needsAlt = mods.has("alt");
  const needsShift = mods.has("shift");

  if (needsCtrl && !e.ctrlKey) return false;
  if (!needsCtrl && !needsMod && e.ctrlKey) return false;
  if (needsMod && !(e.metaKey || e.ctrlKey)) return false;
  if (!needsMod && e.metaKey) return false;
  if (needsAlt && !e.altKey) return false;
  if (!needsAlt && e.altKey) return false;
  if (needsShift && !e.shiftKey) return false;
  if (!needsShift && e.shiftKey) return false;

  return e.key.toLowerCase() === keyChar;
}

function findContext(root: Context, path: string[]): Context {
  let current = root;
  for (const segment of path) {
    const child = current.children.find((c) => c.name === segment);
    if (!child) return current;
    current = child;
  }
  return current;
}

function updateContextInTree(
  root: Context,
  path: string[],
  updater: (ctx: Context) => Context
): Context {
  if (path.length === 0) return updater(root);
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child) =>
      child.name === head ? updateContextInTree(child, rest, updater) : child
    ),
  };
}

const ONTOLOGIES_NAME = "Libs";

/** Build the full lexical scope for the current path: children → ancestry levels → root. */
function buildLexicalScope(
  root: Context,
  currentPath: string[],
): { name: string; summary: string; kind: "contained" | "sibling"; absolutePath: string[] }[] {
  const refs: { name: string; summary: string; kind: "contained" | "sibling"; absolutePath: string[] }[] = [];
  const seen = new Set<string>();
  const currentCtx = findContext(root, currentPath);

  const add = (name: string, ctx: Context, kind: "contained" | "sibling", absolutePath: string[]) => {
    if (!seen.has(name)) {
      seen.add(name);
      refs.push({ name, summary: makeSummary(ctx), kind, absolutePath });
    }
  };

  // Innermost: children of current context
  for (const c of currentCtx.children) {
    add(c.name, c, "contained", [...currentPath, c.name]);
  }

  // Walk up the ancestry chain
  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelCtx = findContext(root, levelPath);
    const parentPath = levelPath.slice(0, -1);
    const parentCtx = findContext(root, parentPath);

    // The ancestor at this level is reachable by name
    add(levelCtx.name, levelCtx, "sibling", levelPath);

    // Its siblings
    for (const c of parentCtx.children) {
      if (c.name !== levelCtx.name) {
        add(c.name, c, "sibling", [...parentPath, c.name]);
      }
    }
  }

  // Root itself
  add(root.name, root, "sibling", []);

  return refs;
}

/** Flatten all descendants of the Ontologies sigil into the global scope. */
function flattenOntologyRefs(
  ctx: Context,
  basePath: string[],
  seen: Set<string>,
  ontologyName: string,
): SiblingInfo[] {
  const refs: SiblingInfo[] = [];
  for (const child of ctx.children) {
    const childPath = [...basePath, child.name];
    if (!seen.has(child.name)) {
      seen.add(child.name);
      refs.push({ name: child.name, summary: makeSummary(child), kind: "lib", absolutePath: childPath, libPrefix: ontologyName });
    }
    refs.push(...flattenOntologyRefs(child, childPath, seen, ontologyName));
  }
  return refs;
}

function buildBreadcrumb(root: Context, path: string[]): { name: string; path: string[] }[] {
  return [{ name: root.name, path: [] }, ...coreBuildBreadcrumb(root, path)];
}

export function EditorShell() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const doc = useDocument();
  const { save } = useAutoSave();
  const { reload } = useSigil();
  const { addToast } = useToast();

  // Global keyboard shortcuts
  useEffect(() => {
    if (!doc) return;
    const kb = state.settings.keybindings || DEFAULT_KEYBINDINGS;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesBinding(e, kb["facet-map"] || "Ctrl-5")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { contentTab: "atlas" } });
        return;
      }
      if (matchesBinding(e, kb["panel-vision"] || "Ctrl-v")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "vision", leftPanelOpen: true } });
        return;
      }
      if (matchesBinding(e, kb["panel-ontology"] || "Ctrl-g")) {
        e.preventDefault();
        dispatch({ type: "UPDATE_DOCUMENT", updates: { leftPanelTab: "ontology", leftPanelOpen: true } });
        return;
      }
      // Find References — only handle when focus is outside the CodeMirror editor
      // (CodeMirror has its own keymap handler for this when focused)
      if (matchesBinding(e, kb["find-references"] || "Alt-Mod-f")) {
        const cm = (e.target as HTMLElement)?.closest(".cm-editor");
        if (!cm) {
          e.preventDefault();
          const ctx = findContext(doc.sigil.root, doc.currentPath);
          dispatch({ type: "UPDATE_DOCUMENT", updates: { findReferencesName: ctx.name } });
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [doc, state.settings.keybindings, dispatch]);

  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending debounced state update when navigating away.
  // This prevents stale content from being written into the wrong sigil's tree slot.
  const prevPathKeyRef = useRef(doc?.currentPath.join("/"));
  useEffect(() => {
    const pathKey = doc?.currentPath.join("/");
    if (pathKey !== prevPathKeyRef.current) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      prevPathKeyRef.current = pathKey;
    }
  }, [doc?.currentPath]);

  const handleContentChange = useCallback((content: string) => {
    if (!doc) return;
    // Capture path at call time so the timeout uses the correct sigil.
    const pathSnapshot = [...doc.currentPath];
    const ctx = findContext(doc.sigil.root, pathSnapshot);
    save(`${ctx.path}/language.md`, content);
    // Debounce the React state update — CodeMirror holds its own state,
    // so other components only need periodic sync.
    if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
    dispatchTimerRef.current = setTimeout(() => {
      const updatedRoot = updateContextInTree(doc.sigil.root, pathSnapshot, (c) => ({
        ...c,
        domain_language: content,
      }));
      dispatch({ type: "UPDATE_SIGIL", sigil: { ...doc.sigil, root: updatedRoot } });
    }, 300);
  }, [doc, save, dispatch]);

  const handleCreateSigil = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const humanName = name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    const dirName = humanName.replace(/\s+/g, "");
    try {
      const newCtx = await api.createContext(ctx.path, dirName);
      const parentStatusMatch = ctx.domain_language?.match(/^---[\s\S]*?^status:\s*(\S+)/m);
      const parentStatus = parentStatusMatch?.[1] ?? "idea";
      await api.writeFile(`${newCtx.path}/language.md`, `---\nstatus: ${parentStatus}\n---\n\n# ${humanName}\n`);
      await reload(doc.sigil.root_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(msg, "error");
    }
  }, [doc, reload, addToast]);

  const handleRenameStatus = useCallback(async (_oldValue: string, newValue: string) => {
    if (!doc || !newValue.trim()) return;
    const statusPattern = /^(status:\s*)\S+$/m;
    const forceStatus = async (ctx: Context) => {
      const lang = ctx.domain_language || "";
      if (statusPattern.test(lang)) {
        await api.writeFile(`${ctx.path}/language.md`, lang.replace(statusPattern, `$1${newValue}`)).catch(console.error);
      } else if (lang.startsWith("---")) {
        const updated = lang.replace(/^---/, `---\nstatus: ${newValue}`);
        await api.writeFile(`${ctx.path}/language.md`, updated).catch(console.error);
      } else {
        const updated = `---\nstatus: ${newValue}\n---\n${lang}`;
        await api.writeFile(`${ctx.path}/language.md`, updated).catch(console.error);
      }
      for (const child of ctx.children) await forceStatus(child);
    };
    // Force status on the current sigil and all its descendants
    const currentCtx = findContext(doc.sigil.root, doc.currentPath);
    await forceStatus(currentCtx);
    await reload(doc.sigil.root_path);
  }, [doc, reload]);

  const handleCreateAffordance = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    try {
      await api.writeFile(`${ctx.path}/affordance-${name}.md`, "");
      await reload(doc.sigil.root_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(msg, "error");
    }
  }, [doc, reload, addToast]);

  const handleCreateInvariant = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    try {
      await api.writeFile(`${ctx.path}/invariant-${name}.md`, "");
      await reload(doc.sigil.root_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(msg, "error");
    }
  }, [doc, reload, addToast]);

  const handleRenameProperty = useCallback(async (kind: "affordance" | "invariant", oldName: string, newName: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const prefix = kind === "affordance" ? "affordance" : "invariant";
    const oldPath = `${ctx.path}/${prefix}-${oldName}.md`;
    const newPath = `${ctx.path}/${prefix}-${newName}.md`;
    try {
      // Read old content, write to new path, delete old
      const oldContent = await api.readFile(oldPath).catch(() => "");
      await api.writeFile(newPath, oldContent);
      await api.deleteFile(oldPath);
      // Update references in language.md: replace #old-name or !old-name with new name
      const langPath = `${ctx.path}/language.md`;
      const lang = ctx.domain_language;
      const refChar = kind === "affordance" ? "#" : "!";
      const updated = lang.replace(
        new RegExp(`\\${refChar}${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-zA-Z0-9_-]|$)`, "g"),
        `${refChar}${newName}`
      );
      if (updated !== lang) {
        await api.writeFile(langPath, updated);
      }
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error(`Rename ${kind} failed:`, err);
    }
  }, [doc, reload]);

  const handleRenameSigil = useCallback(async (oldName: string, newName: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    // Check contained sigils first
    let target = ctx.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    // Then check neighbors
    if (!target && doc.currentPath.length > 0) {
      const parentPath = doc.currentPath.slice(0, -1);
      const parent = findContext(doc.sigil.root, parentPath);
      target = parent.children.find((c) => c.name.toLowerCase() === oldName.toLowerCase());
    }
    if (target) {
      try {
        await api.renameSigil(doc.sigil.root_path, target.path, newName);
        await reload(doc.sigil.root_path);
      } catch (err) {
        console.error("Rename sigil failed:", err);
      }
    }
  }, [doc, reload]);

  const handleNavigateToSigil = useCallback((name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    // Check if it's a contained sigil (resolving plurals)
    const containedNames = ctx.children.map((c) => c.name);
    const resolvedContained = resolveRefName(name, containedNames);
    if (resolvedContained) {
      dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: [...doc.currentPath, resolvedContained] } });
      return;
    }
    // Check if it's a neighbor — navigate to it at the same level
    if (doc.currentPath.length > 0) {
      const parentPath = doc.currentPath.slice(0, -1);
      const parent = findContext(doc.sigil.root, parentPath);
      const neighborNames = parent.children.filter((c) => c.name !== ctx.name).map((c) => c.name);
      const resolvedNeighbor = resolveRefName(name, neighborNames);
      if (resolvedNeighbor) {
        dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: [...parentPath, resolvedNeighbor] } });
      }
    }
  }, [doc, dispatch]);

  // Stable fingerprint of tree structure (names only, ignoring content changes)
  const treeFingerprint = useMemo(() => {
    function walk(ctx: Context): string {
      return ctx.name + "(" + ctx.children.map(walk).join(",") + ")";
    }
    return doc ? walk(doc.sigil.root) : "";
  }, [doc?.sigil.root]);

  // Memoize lexical scope — only recomputes when tree structure or current path changes
  const { allRefs, allRefNames } = useMemo(() => {
    if (!doc) return { allRefs: [] as SiblingInfo[], allRefNames: [] as string[] };
    const refs: SiblingInfo[] = buildLexicalScope(doc.sigil.root, doc.currentPath);
    const seenNames = new Set(refs.map((r) => r.name));
    const ontologiesSigil = doc.sigil.root.children.find((c) => c.name === ONTOLOGIES_NAME);
    if (ontologiesSigil) {
      for (const ontology of ontologiesSigil.children) {
        // Add the ontology itself (e.g. AttentionLanguage) as a resolvable name
        if (!seenNames.has(ontology.name)) {
          seenNames.add(ontology.name);
          refs.push({ name: ontology.name, summary: makeSummary(ontology), kind: "lib", absolutePath: [ONTOLOGIES_NAME, ontology.name], libPrefix: ontology.name });
        }
        refs.push(...flattenOntologyRefs(ontology, [ONTOLOGIES_NAME, ontology.name], seenNames, ontology.name));
      }
    }
    return { allRefs: refs, allRefNames: refs.map((r) => r.name) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeFingerprint, doc?.currentPath]);

  // Core refs (with affordances/invariants) for preview highlighting
  const coreRefs = useMemo(() => {
    if (!doc) return [];
    return coreBuildLexicalScope(doc.sigil.root, doc.currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeFingerprint, doc?.currentPath]);

  if (!doc) return null;

  const currentCtx = findContext(doc.sigil.root, doc.currentPath);
  const breadcrumbs = buildBreadcrumb(doc.sigil.root, doc.currentPath);
  const content = currentCtx.domain_language;

  return (
    <div className={styles.shell}>
      <LeftPanel />
      <div className={styles.center}>
        <Breadcrumb
          crumbs={breadcrumbs}
          onNavigate={(path) =>
            dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })
          }
        />
        <EditorToolbar />
        {(doc.contentTab || "language") !== "atlas" && (
          <SigilPropertyEditor
            sigilPath={currentCtx.path}
            filePrefix="affordance"
            title="Affordances"
            refPrefix="#"
            color="#3d9e8c"
            namePlaceholder="I need to..."
            contentPlaceholder="so that..."
            items={currentCtx.affordances}
            onReload={() => reload(doc.sigil.root_path).then(() => {})}
            siblings={allRefs}
            siblingNames={allRefNames}
            sigilRoot={doc.sigil.root}
            currentContext={currentCtx}
            currentPath={doc.currentPath}
            onCreateAffordance={handleCreateAffordance}
            onCreateInvariant={handleCreateInvariant}
            onRenameSigil={handleRenameSigil}
            onRenameProperty={handleRenameProperty}
            onNavigateToSigil={handleNavigateToSigil}
            onNavigateToAbsPath={(path) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })}
            keybindings={state.settings.keybindings as unknown as Record<string, string>}
          />
        )}
        <div className={styles.editorArea}>
          {(doc.contentTab || "language") === "atlas" ? (
            <SigilMap />
          ) : (
            <>
              {(doc.editorMode === "edit" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
                  <MarkdownEditor
                    content={content}
                    onChange={handleContentChange}
                    siblingNames={allRefNames}
                    siblings={allRefs}
                    sigilRoot={doc.sigil.root}
                    currentContext={currentCtx}
                    currentPath={doc.currentPath}
                    wordWrap={doc.wordWrap}
                    onCreateSigil={handleCreateSigil}
                    onCreateAffordance={handleCreateAffordance}
                    onCreateInvariant={handleCreateInvariant}
                    onRenameSigil={handleRenameSigil}
                    onRenameProperty={handleRenameProperty}
                    onRenameStatus={handleRenameStatus}
                    onNavigateToSigil={handleNavigateToSigil}
                    onNavigateToAbsPath={(path) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })}
                    keybindings={state.settings.keybindings as unknown as Record<string, string>}
                    findReferencesName={doc.findReferencesName}
                    onFindReferencesClear={() => dispatch({ type: "UPDATE_DOCUMENT", updates: { findReferencesName: null } })}
                  />
                </div>
              )}
              {(doc.editorMode === "preview" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} refs={coreRefs} />
                </div>
              )}
            </>
          )}
        </div>
        {(doc.contentTab || "language") !== "atlas" && (
          <SigilPropertyEditor
            sigilPath={currentCtx.path}
            filePrefix="invariant"
            title="Invariants"
            refPrefix="!"
            color="#e8a040"
            namePlaceholder="what must hold..."
            contentPlaceholder="because..."
            items={currentCtx.invariants}
            onReload={() => reload(doc.sigil.root_path).then(() => {})}
            siblings={allRefs}
            siblingNames={allRefNames}
            sigilRoot={doc.sigil.root}
            currentContext={currentCtx}
            currentPath={doc.currentPath}
            onCreateAffordance={handleCreateAffordance}
            onCreateInvariant={handleCreateInvariant}
            onRenameSigil={handleRenameSigil}
            onRenameProperty={handleRenameProperty}
            onNavigateToSigil={handleNavigateToSigil}
            onNavigateToAbsPath={(path) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })}
            keybindings={state.settings.keybindings as unknown as Record<string, string>}
          />
        )}
        <SubContextBar context={currentCtx} />
      </div>
      <ChatPanel />
    </div>
  );
}
