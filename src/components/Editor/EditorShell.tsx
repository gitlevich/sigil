import { useCallback } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { LeftPanel } from "../LeftPanel/LeftPanel";
import { ChatPanel } from "../RightPanel/ChatPanel";
import { Breadcrumb } from "./Breadcrumb";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { EditorToolbar } from "./EditorToolbar";
import { SubContextBar } from "./SubContextBar";
import { Context, api } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
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
    const fileName = doc.showTechnical ? "technical.md" : "language.md";
    const filePath = `${ctx.path}/${fileName}`;
    save(filePath, content);

    const updatedRoot = updateContextInTree(doc.sigil.root, doc.currentPath, (c) =>
      doc.showTechnical
        ? { ...c, technical_decisions: content }
        : { ...c, domain_language: content }
    );
    dispatch({
      type: "UPDATE_SIGIL",
      sigil: { ...doc.sigil, root: updatedRoot },
    });
  }, [doc, save, dispatch]);

  const handleCreateTechnical = useCallback(() => {
    if (!doc) return;
    const ctx = findContext(doc.sigil.root, doc.currentPath);
    const filePath = `${ctx.path}/technical.md`;
    api.writeFile(filePath, "").catch(console.error);
    const updatedRoot = updateContextInTree(doc.sigil.root, doc.currentPath, (c) => ({
      ...c,
      technical_decisions: "",
    }));
    dispatch({
      type: "UPDATE_SIGIL",
      sigil: { ...doc.sigil, root: updatedRoot },
    });
  }, [doc, dispatch]);

  if (!doc) return null;

  const currentCtx = findContext(doc.sigil.root, doc.currentPath);
  const breadcrumbs = buildBreadcrumb(doc.sigil.root, doc.currentPath);

  const content = doc.showTechnical
    ? currentCtx.technical_decisions ?? ""
    : currentCtx.domain_language;

  const inheritedTech = !doc.showTechnical ? null : (() => {
    if (currentCtx.technical_decisions !== null) return null;
    let current = doc.sigil.root;
    let lastTech: { content: string; name: string } | null = null;
    if (current.technical_decisions) {
      lastTech = { content: current.technical_decisions, name: current.name };
    }
    for (const seg of doc.currentPath) {
      const child = current.children.find((c) => c.name === seg);
      if (!child) break;
      if (child.technical_decisions) {
        lastTech = { content: child.technical_decisions, name: child.name };
      }
      current = child;
    }
    return lastTech;
  })();

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
          {doc.showTechnical && currentCtx.technical_decisions === null && inheritedTech ? (
            <div className={styles.inherited}>
              <p className={styles.inheritedLabel}>
                Inherited from: {inheritedTech.name}
              </p>
              <MarkdownPreview content={inheritedTech.content} />
              <button
                className={styles.createTechBtn}
                onClick={handleCreateTechnical}
              >
                Create technical.md for this context
              </button>
            </div>
          ) : doc.showTechnical && currentCtx.technical_decisions === null && !inheritedTech ? (
            <div className={styles.inherited}>
              <p className={styles.inheritedLabel}>No technical decisions defined</p>
              <button
                className={styles.createTechBtn}
                onClick={handleCreateTechnical}
              >
                Create technical.md for this context
              </button>
            </div>
          ) : (
            <>
              {(doc.editorMode === "edit" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
                  <MarkdownEditor
                    content={content}
                    onChange={handleContentChange}
                  />
                </div>
              )}
              {(doc.editorMode === "preview" || doc.editorMode === "split") && (
                <div className={doc.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
                  <MarkdownPreview content={content} />
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
