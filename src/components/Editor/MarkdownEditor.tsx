import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import styles from "./MarkdownEditor.module.css";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
}

const themeCompartment = new Compartment();

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-secondary)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-hover)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--bg-hover)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-primary)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--accent) !important",
    opacity: "0.3",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--accent) !important",
    opacity: "0.3",
  },
});

function getThemeExtension(): typeof oneDark | typeof lightTheme {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" ? oneDark : lightTheme;
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track whether the last change originated from the editor itself.
  // When true, the content-sync effect should skip updating CodeMirror
  // because it already has the right content (and may have newer keystrokes).
  const localEditRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            localEditRef.current = true;
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for theme changes via MutationObserver on data-theme attribute
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.reconfigure(getThemeExtension()),
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  // Sync external content changes into CodeMirror.
  // Skip if the change came from the editor itself (localEditRef).
  useEffect(() => {
    if (localEditRef.current) {
      localEditRef.current = false;
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={containerRef} className={styles.editor} />;
}
