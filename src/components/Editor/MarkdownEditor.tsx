import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, RangeSetBuilder, Transaction } from "@codemirror/state";
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
  wordWrap?: boolean;
  onCreateSigil?: (name: string) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onNavigateToSigil?: (name: string) => void;
  keybindings?: Record<string, string>;
}

const themeCompartment = new Compartment();
const siblingCompartment = new Compartment();
const keymapCompartment = new Compartment();
const wrapCompartment = new Compartment();

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
const unresolvedMark = Decoration.mark({ class: "cm-ref-unresolved" });

let globalSiblings: SiblingInfo[] = [];

// Matches all @references: @Name and @Name.affordance
const allRefsPattern = /@([a-zA-Z_][\w-]*)(\.[a-zA-Z_][\w]*)?/g;

/** Resolve a (possibly plural) ref name to the canonical sigil name, or undefined if unknown. */
export function resolveRefName(refName: string, knownNames: string[]): string | undefined {
  const lower = refName.toLowerCase();
  let match = knownNames.find((n) => n.toLowerCase() === lower);
  if (match) return match;
  if (lower.endsWith("ies") && lower.length > 3) {
    const stem = lower.slice(0, -3) + "y";
    match = knownNames.find((n) => n.toLowerCase() === stem);
    if (match) return match;
  }
  if (lower.endsWith("s") && lower.length > 1) {
    const stem = lower.slice(0, -1);
    match = knownNames.find((n) => n.toLowerCase() === stem);
    if (match) return match;
  }
  return undefined;
}

function findSibling(name: string): SiblingInfo | undefined {
  const canonical = resolveRefName(name, globalSiblings.map((s) => s.name));
  return canonical ? globalSiblings.find((s) => s.name === canonical) : undefined;
}

function buildSiblingHighlighter(_names: string[], siblings: SiblingInfo[]) {
  globalSiblings = siblings;

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
            allRefsPattern.lastIndex = 0;
            while ((match = allRefsPattern.exec(text)) !== null) {
              const baseName = match[1];
              const info = findSibling(baseName);
              let mark: Decoration;
              if (info) {
                mark = info.kind === "sibling" ? siblingMark : containedMark;
              } else {
                mark = unresolvedMark;
              }
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
      ".cm-ref-unresolved": {
        textDecoration: "underline wavy",
        textDecorationColor: "var(--danger)",
        textUnderlineOffset: "3px",
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
      const localPattern = /@([a-zA-Z_][\w-]*)(\.[a-zA-Z_][\w]*)?/g;
      let match;
      while ((match = localPattern.exec(text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (pos >= from && pos <= to) {
          const baseName = match[1];
          const sib = findSibling(baseName);
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

/** Find the @reference name at the cursor position, if any. */
function findRefAtCursor(view: EditorView): { name: string; from: number; known: boolean } | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const refPattern = /@([a-zA-Z_][\w-]*)/g;
  let match;
  while ((match = refPattern.exec(line.text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      const raw = match[1];
      const canonical = resolveRefName(raw, globalSiblings.map((s) => s.name));
      const known = canonical !== undefined;
      return { name: canonical ?? raw, from, known };
    }
  }
  return null;
}

type SetRenameState = (s: { oldName: string; x: number; y: number } | null) => void;

function buildCustomKeymap(
  kb: Record<string, string>,
  setRenameState: SetRenameState,
  onCreateSigilRef: React.MutableRefObject<((name: string) => void) | undefined>,
) {
  return keymap.of([
    {
      key: kb["rename-sigil"] || "Alt-Mod-r",
      run: (view) => {
        const ref = findRefAtCursor(view);
        if (ref?.known) {
          const coords = view.coordsAtPos(ref.from);
          if (coords) setRenameState({ oldName: ref.name, x: coords.left, y: coords.bottom + 4 });
          return true;
        }
        return false;
      },
    },
    {
      key: kb["create-sigil"] || "Alt-Enter",
      run: (view) => {
        const ref = findRefAtCursor(view);
        if (ref && !ref.known && onCreateSigilRef.current) {
          onCreateSigilRef.current(ref.name);
          return true;
        }
        return false;
      },
    },
    {
      key: kb["delete-line"] || "Mod-d",
      run: (view) => {
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const from = line.from;
        const to = Math.min(line.to + 1, view.state.doc.length);
        view.dispatch({ changes: { from, to } });
        return true;
      },
    },
  ]);
}

export function MarkdownEditor({ content, onChange, siblingNames = [], siblings = [], wordWrap = false, onCreateSigil, onRenameSigil, onNavigateToSigil, keybindings = {} }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateSigilRef = useRef(onCreateSigil);
  onCreateSigilRef.current = onCreateSigil;
  const onRenameSigilRef = useRef(onRenameSigil);
  onRenameSigilRef.current = onRenameSigil;
  const onNavigateRef = useRef(onNavigateToSigil);
  onNavigateRef.current = onNavigateToSigil;
  const [renameState, setRenameState] = useState<{ oldName: string; x: number; y: number } | null>(null);
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
        keymapCompartment.of(buildCustomKeymap(keybindings, setRenameState, onCreateSigilRef)),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        siblingCompartment.of(buildSiblingHighlighter(siblingNames, siblings)),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
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
        EditorView.domEventHandlers({
          click: (event, view) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos);
            const refPattern = /@([a-zA-Z_][\w-]*)/g;
            let match;
            while ((match = refPattern.exec(line.text)) !== null) {
              const from = line.from + match.index;
              const to = from + match[0].length;
              if (pos >= from && pos <= to) {
                const name = match[1];
                if (onNavigateRef.current) {
                  onNavigateRef.current(name);
                  event.preventDefault();
                  return true;
                }
              }
            }
            return false;
          },
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "var(--content-font-size, 16px)" },
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

  // Reconfigure custom keymap when keybindings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartment.reconfigure(buildCustomKeymap(keybindings, setRenameState, onCreateSigilRef)),
    });
  }, [keybindings]);

  // Update sibling highlighting when siblings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: siblingCompartment.reconfigure(buildSiblingHighlighter(siblingNames, siblings)),
    });
  }, [siblingNames, siblings]);

  // Toggle word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  // Sync external content changes into CodeMirror.
  // Skip if the change is an echo of a local edit (localEditRef).
  // But always sync if the content is completely different (navigation).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();

    if (localEditRef.current) {
      // Check if this is truly an echo (content matches what we just typed)
      // vs a navigation to a different context (content is completely different)
      if (currentDoc === content) {
        localEditRef.current = false;
        return;
      }
      // Content is different from what's in the editor — this is navigation, not echo
      localEditRef.current = false;
    }

    if (currentDoc !== content) {
      // This is navigation to a different sigil. Replace content and clear undo history.
      // Without this, Cmd+Z undoes into the previous sigil's content and corrupts the file.
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
        annotations: [Transaction.addToHistory.of(false)],
      });
    }
  }, [content]);

  return (
    <div ref={containerRef} className={styles.editor}>
      {renameState && (
        <div
          style={{
            position: "absolute",
            left: renameState.x,
            top: renameState.y,
            zIndex: 100,
          }}
        >
          <input
            autoFocus
            defaultValue={renameState.oldName}
            style={{
              padding: "2px 6px",
              fontSize: "13px",
              border: "1px solid var(--accent)",
              borderRadius: "3px",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              outline: "none",
              minWidth: "120px",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const newName = e.currentTarget.value.trim();
                if (newName && newName !== renameState.oldName && onRenameSigilRef.current) {
                  onRenameSigilRef.current(renameState.oldName, newName);
                }
                setRenameState(null);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRenameState(null);
              }
            }}
            onBlur={() => setRenameState(null)}
          />
        </div>
      )}
    </div>
  );
}
