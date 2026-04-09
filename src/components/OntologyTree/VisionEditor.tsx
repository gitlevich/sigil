import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { useWorkspaceState, useWorkspaceDispatch } from "../../state/WorkspaceContext";
import { useAutoSave } from "../../hooks/useAutoSave";
import { MarkdownPreview } from "../Workspace/MarkdownPreview";
import {
  buildSiblingHighlighter,
  getThemeExtension,
  getGlobalSiblings,
  getGlobalSigilRoot,
  getGlobalCurrentContext,
  getGlobalCurrentPath,
} from "../Workspace/sigilExtensions";
import styles from "./VisionEditor.module.css";

const themeCompartment = new Compartment();
const siblingCompartment = new Compartment();

function buildVisionHighlighter() {
  const siblings = getGlobalSiblings();
  const root = getGlobalSigilRoot();
  const ctx = getGlobalCurrentContext();
  const path = getGlobalCurrentPath();
  const names = siblings.map((s) => s.name);
  return buildSiblingHighlighter(names, siblings, root, ctx, path);
}

export function VisionEditor() {
  const ws = useWorkspaceState();
  const wsDispatch = useWorkspaceDispatch();
  const { save } = useAutoSave();
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef<(value: string) => void>(() => {});

  const handleChange = (value: string) => {
    const path = `${ws.spec.rootPath}/vision.md`;
    save(path, value);
    wsDispatch({
      type: "UPDATE_SPEC",
      spec: { ...ws.spec, vision: value },
    });
  };

  onChangeRef.current = handleChange;

  // Create CodeMirror instance
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: ws.spec.vision ?? "",
      extensions: [
        highlightActiveLine(),
        history(),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        siblingCompartment.of(buildVisionHighlighter()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "var(--content-font-size, 16px)" },
          ".cm-scroller": { overflow: "auto", padding: "0.5rem 0" },
          ".cm-content": {
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            padding: "0 0.75rem",
          },
          ".cm-gutters": { display: "none" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      viewRef.current?.dispatch({
        effects: themeCompartment.reconfigure(getThemeExtension()),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Sync external content (e.g. navigation to different sigil)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const incoming = ws.spec.vision;
    if (current !== incoming) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: incoming },
        annotations: [Transaction.addToHistory.of(false)],
      });
    }
  }, [ws.spec.vision]);

  // Refresh sigil reference highlighting when context changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: siblingCompartment.reconfigure(buildVisionHighlighter()),
    });
  }, [ws.spec]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          className={`${styles.modeBtn} ${mode === "edit" ? styles.active : ""}`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        <button
          className={`${styles.modeBtn} ${mode === "preview" ? styles.active : ""}`}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>

      <div className={styles.content}>
        <div
          ref={containerRef}
          className={styles.editorContainer}
          style={{ display: mode === "edit" ? "block" : "none" }}
        />
        {mode === "preview" && (
          <div className={styles.previewArea}>
            {ws.spec.vision ? (
              <MarkdownPreview content={ws.spec.vision} />
            ) : (
              <p className={styles.placeholder}>
                No vision statement yet. Switch to Edit to write one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
