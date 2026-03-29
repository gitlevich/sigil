import { useEffect, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  Decoration, DecorationSet, ViewPlugin, ViewUpdate,
  hoverTooltip,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import styles from "./MarkdownEditor.module.css";

export interface SiblingInfo {
  name: string;
  summary: string;
  kind?: "contained" | "sibling";
}

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  siblingNames?: string[];
  siblings?: SiblingInfo[];
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

const containedMark = Decoration.mark({ class: "cm-ref-contained" });
const siblingMark = Decoration.mark({ class: "cm-ref-sibling" });

let globalSiblings: SiblingInfo[] = [];

function buildSiblingHighlighter(names: string[], siblings: SiblingInfo[]) {
  globalSiblings = siblings;
  if (names.length === 0) return [];

  // Match @name and @name.affordance — explicit sibling references
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");

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
              const baseName = match[1];
              const info = globalSiblings.find((s) => s.name.toLowerCase() === baseName.toLowerCase());
              const mark = info?.kind === "sibling" ? siblingMark : containedMark;
              builder.add(from + match.index, from + match.index + match[0].length, mark);
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    ),
    EditorView.theme({
      ".cm-ref-contained": {
        borderBottom: "2px solid var(--accent)",
        borderRadius: "1px",
        paddingBottom: "1px",
      },
      ".cm-ref-sibling": {
        borderBottom: "2px dashed #e8a040",
        borderRadius: "1px",
        paddingBottom: "1px",
      },
      ".cm-tooltip-autocomplete": {
        background: "var(--bg-primary)",
        border: "1px solid var(--border)",
        borderRadius: "4px",
        fontSize: "13px",
      },
      ".cm-tooltip-autocomplete ul li": {
        padding: "4px 8px",
        color: "var(--text-secondary)",
        opacity: "0.6",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        background: "#2860a8 !important",
        color: "#ffffff !important",
        opacity: "1 !important",
      },
      ".cm-tooltip-autocomplete .cm-completionDetail": {
        color: "var(--text-secondary)",
        fontStyle: "italic",
        marginLeft: "8px",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail": {
        color: "#ffffff !important",
        opacity: "0.7",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionIcon": {
        color: "#ffffff !important",
      },
      ".cm-tooltip-sibling": {
        padding: "6px 10px",
        maxWidth: "300px",
        fontSize: "12px",
        lineHeight: "1.4",
        background: "var(--bg-primary)",
        border: "1px solid var(--border)",
        borderRadius: "4px",
        color: "var(--text-primary)",
        boxShadow: "0 2px 8px var(--shadow)",
      },
      ".cm-tooltip-sibling .cm-tooltip-sibling-name": {
        fontWeight: "600",
        marginBottom: "4px",
      },
      ".cm-tooltip-sibling .cm-tooltip-sibling-summary": {
        color: "var(--text-secondary)",
        whiteSpace: "pre-wrap",
      },
    }),
    hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const localPattern = new RegExp(`@(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");
      let match;
      while ((match = localPattern.exec(text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (pos >= from && pos <= to) {
          const baseName = match[1];
          const sib = globalSiblings.find((s) => s.name.toLowerCase() === baseName.toLowerCase());
          if (!sib) return null;
          return {
            pos: from,
            end: to,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "cm-tooltip-sibling";
              const nameEl = document.createElement("div");
              nameEl.className = "cm-tooltip-sibling-name";
              nameEl.textContent = sib.name;
              dom.appendChild(nameEl);
              if (sib.summary) {
                const summaryEl = document.createElement("div");
                summaryEl.className = "cm-tooltip-sibling-summary";
                summaryEl.textContent = sib.summary;
                dom.appendChild(summaryEl);
              }
              return { dom };
            },
          };
        }
      }
      return null;
    }),
  ];
}

function siblingCompletion(context: CompletionContext) {
  // Match @word or just @ at cursor
  const before = context.matchBefore(/@[\w-]*/);
  if (!before) return null;
  // Allow bare @ to trigger (from includes the @)
  if (globalSiblings.length === 0) return null;
  return {
    from: before.from,
    options: globalSiblings.map((s) => ({
      label: `@${s.name}`,
      detail: `${s.kind === "sibling" ? "[neighbor] " : ""}${s.summary.split("\n")[0]?.slice(0, 50) || ""}`,
      type: s.kind === "sibling" ? "property" as const : "variable" as const,
    })),
    filter: true,
  };
}

export function MarkdownEditor({ content, onChange, siblingNames = [], siblings = [] }: MarkdownEditorProps) {
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
        siblingCompartment.of(buildSiblingHighlighter(siblingNames, siblings)),
        autocompletion({
          override: [siblingCompletion],
          activateOnTyping: true,
          activateOnTypingDelay: 0,
        }),
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
      effects: siblingCompartment.reconfigure(buildSiblingHighlighter(siblingNames, siblings)),
    });
  }, [siblingNames, siblings]);

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
