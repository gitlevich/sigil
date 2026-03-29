import { useCallback } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { LeftPanel } from "../LeftPanel/LeftPanel";
import { ChatPanel } from "../RightPanel/ChatPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { Context } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { EntanglementGraph } from "./EntanglementGraph";
import styles from "./EditorShell.module.css";

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
  const doc = useDocument();
  const { save } = useAutoSave();

  const handleContentChange = useCallback((content: string) => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const filePath = `${ctx.path}/language.md`;
    save(filePath, content);

    const updatedRoot = updateContextInTree(doc.sigil.root, doc.currentPath, (c) => ({
      ...c,
      domain_language: content,
    }));
    dispatch({
      type: "UPDATE_SIGIL",
      sigil: { ...doc.sigil, root: updatedRoot },
    });
  }, [doc, save, dispatch]);

  if (!doc) return null;

  const currentCtx = findContext(doc.sigil.root, doc.currentPath);
  const breadcrumbs = buildBreadcrumb(doc.sigil.root, doc.currentPath);

  // Compute sibling names: the other children of the containing sigil
  const siblingNames = (() => {
    if (doc.currentPath.length === 0) {
      // At root — no siblings, but children are visible as sub-contexts
      return [];
    }
    const containingPath = doc.currentPath.slice(0, -1);
    const containingSigil = findContext(doc.sigil.root, containingPath);
    return containingSigil.children
      .map((c) => c.name)
      .filter((name) => name !== currentCtx.name);
  })();

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
        <div className={styles.editorArea}>
          {(doc.contentTab || "language") === "entanglements" ? (
            <EntanglementGraph />
          ) : (
            <>
              {(doc.editorMode === "edit" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
                  <MarkdownEditor
                    content={content}
                    onChange={handleContentChange}
                    siblingNames={siblingNames}
                  />
                </div>
              )}
              {(doc.editorMode === "preview" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} siblingNames={siblingNames} />
                </div>
              )}
            </>
          )}
        </div>
        <SubContextBar context={currentCtx} />
      </div>
      <ChatPanel />
    </div>
  );
}
