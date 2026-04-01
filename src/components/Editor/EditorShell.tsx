import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppState, useDocument } from "../../state/AppContext";
import { LeftPanel } from "../LeftPanel/LeftPanel";
import { ChatPanel } from "../RightPanel/ChatPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor, resolveRefName } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { Context, api, DEFAULT_KEYBINDINGS } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useSigil } from "../../hooks/useSigil";
import { SigilMap } from "./Map";
import { SigilPropertyEditor } from "./SigilPropertyEditor";
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

const ONTOLOGIES_NAME = "Ontologies";

function makeSummary(ctx: Context): string {
  let text = ctx.domain_language || "";
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  return text.split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
    .slice(0, 3)
    .join("\n");
}

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
): { name: string; summary: string; kind: "sibling"; absolutePath: string[] }[] {
  const refs: { name: string; summary: string; kind: "sibling"; absolutePath: string[] }[] = [];
  for (const child of ctx.children) {
    const childPath = [...basePath, child.name];
    if (!seen.has(child.name)) {
      seen.add(child.name);
      refs.push({ name: child.name, summary: makeSummary(child), kind: "sibling", absolutePath: childPath });
    }
    refs.push(...flattenOntologyRefs(child, childPath, seen));
  }
  return refs;
}

function buildBreadcrumb(root: Context, path: string[]): { name: string; path: string[] }[] {
  const crumbs: { name: string; path: string[] }[] = [{ name: root.name, path: [] }];
  let current = root;
  for (let i = 0; i < path.length; i++) {
    const child = current.children.find((c) => c.name === path[i]);
    if (!child) break;
    crumbs.push({ name: child.name, path: path.slice(0, i + 1) });
    current = child;
  }
  return crumbs;
}

export function EditorShell() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const doc = useDocument();
  const { save } = useAutoSave();
  const { reload } = useSigil();

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
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [doc, state.settings.keybindings, dispatch]);

  const handleContentChange = useCallback((content: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    save(`${ctx.path}/language.md`, content);
    const updatedRoot = updateContextInTree(doc.sigil.root, doc.currentPath, (c) => ({
      ...c,
      domain_language: content,
    }));
    dispatch({ type: "UPDATE_SIGIL", sigil: { ...doc.sigil, root: updatedRoot } });
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
      console.error("Create sigil failed:", err);
    }
  }, [doc, reload]);

  const handleRenameStatus = useCallback(async (oldValue: string, newValue: string) => {
    if (!doc || !newValue.trim() || newValue === oldValue) return;
    const pattern = new RegExp(`^(status:\\s*)${oldValue}$`, "m");
    const updateCtx = async (ctx: Context) => {
      const lang = ctx.domain_language || "";
      if (pattern.test(lang)) {
        await api.writeFile(`${ctx.path}/language.md`, lang.replace(pattern, `$1${newValue}`)).catch(console.error);
      }
      for (const child of ctx.children) await updateCtx(child);
    };
    // Propagate downward from the current sigil — children with a different status are untouched
    const currentCtx = findContext(doc.sigil.root, doc.currentPath);
    await updateCtx(currentCtx);
    await reload(doc.sigil.root_path);
  }, [doc, reload]);

  const handleCreateAffordance = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    try {
      await api.writeFile(`${ctx.path}/affordance-${name}.md`, "");
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Create affordance failed:", err);
    }
  }, [doc, reload]);

  const handleCreateSignal = useCallback(async (name: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    try {
      await api.writeFile(`${ctx.path}/signal-${name}.md`, "");
      await reload(doc.sigil.root_path);
    } catch (err) {
      console.error("Create signal failed:", err);
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

  if (!doc) return null;

  const currentCtx = findContext(doc.sigil.root, doc.currentPath);
  const breadcrumbs = buildBreadcrumb(doc.sigil.root, doc.currentPath);

  // Lexical scope: full ancestry chain + Ontologies descendants always in scope
  const allRefs = buildLexicalScope(doc.sigil.root, doc.currentPath);
  const seenNames = new Set(allRefs.map((r) => r.name));
  const ontologiesSigil = doc.sigil.root.children.find((c) => c.name === ONTOLOGIES_NAME);
  if (ontologiesSigil) {
    allRefs.push(...flattenOntologyRefs(ontologiesSigil, [ONTOLOGIES_NAME], seenNames));
  }
  const allRefNames = allRefs.map((r) => r.name);

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
                    wordWrap={doc.wordWrap}
                    onCreateSigil={handleCreateSigil}
                    onCreateAffordance={handleCreateAffordance}
                    onCreateSignal={handleCreateSignal}
                    onRenameSigil={handleRenameSigil}
                    onRenameStatus={handleRenameStatus}
                    onNavigateToSigil={handleNavigateToSigil}
                    onNavigateToAbsPath={(path) => dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } })}
                    keybindings={state.settings.keybindings as unknown as Record<string, string>}
                  />
                </div>
              )}
              {(doc.editorMode === "preview" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} siblingNames={allRefNames} siblings={allRefs} />
                </div>
              )}
            </>
          )}
        </div>
        {(doc.contentTab || "language") !== "atlas" && (
          <SigilPropertyEditor
            sigilPath={currentCtx.path}
            filePrefix="signal"
            title="Relevant Signals"
            refPrefix="!"
            color="#e8a040"
            namePlaceholder="I care about..."
            contentPlaceholder="because..."
            items={currentCtx.signals}
            onReload={() => reload(doc.sigil.root_path).then(() => {})}
          />
        )}
        <SubContextBar context={currentCtx} />
      </div>
      <ChatPanel />
    </div>
  );
}
