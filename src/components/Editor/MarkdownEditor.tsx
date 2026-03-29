import { useEffect, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  Decoration, DecorationSet, ViewPlugin, ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import styles from "./MarkdownEditor.module.css";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  siblingNames?: string[];
}

const themeCompartment = new Compartment();
const siblingCompartment = new Compartment();

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

const siblingMark = Decoration.mark({ class: "cm-sibling-ref" });

function buildSiblingHighlighter(names: string[]) {
  if (names.length === 0) return [];

  // Build a case-insensitive regex that matches sibling names as whole words
  // Also matches name.something (affordance notation)
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");

  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = this.build(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.build(update.view);
          }
        }
        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            let match;
            pattern.lastIndex = 0;
            while ((match = pattern.exec(text)) !== null) {
              builder.add(from + match.index, from + match.index + match[0].length, siblingMark);
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    ),
    EditorView.theme({
      ".cm-sibling-ref": {
        borderBottom: "2px solid var(--accent)",
        borderRadius: "1px",
        paddingBottom: "1px",
      },
    }),
  ];
}

export function MarkdownEditor({ content, onChange, siblingNames = [] }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
        siblingCompartment.of(buildSiblingHighlighter(siblingNames)),
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

  // Watch for theme changes
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

  // Update sibling highlighting when siblings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: siblingCompartment.reconfigure(buildSiblingHighlighter(siblingNames)),
    });
  }, [siblingNames]);

  // Sync external content changes into CodeMirror.
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
