import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, RangeSetBuilder, Transaction, StateField, StateEffect } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  Decoration, DecorationSet, WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { Context } from "../../tauri";
import { resolveRefName, flattenName, fromDashForm } from "sigil-core";
import {
  SiblingInfo,
  siblingCompletion,
  buildSiblingHighlighter,
  getThemeExtension,
  allRefsPattern,
  isInCodeSpan,
  findPropSeparator,
  resolveChainedRef,
  findRefAtCursor,
  findPropertyRefAtCursor,
  getFrontMatterEnd,
  getGlobalSigilRoot,
  findInvariantInScopeLocal,
  findAffordanceInScopeLocal,
} from "./sigilExtensions";
import styles from "./MarkdownEditor.module.css";

export type { SiblingInfo } from "./sigilExtensions";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  siblingNames?: string[];
  siblings?: SiblingInfo[];
  sigilRoot?: Context;
  currentContext?: Context;
  currentPath?: string[];
  wordWrap?: boolean;
  onCreateSigil?: (name: string) => void;
  onCreateAffordance?: (name: string) => void;
  onCreateInvariant?: (name: string) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onRenameProperty?: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onRenameStatus?: (oldValue: string, newValue: string) => void;
  onNavigateToSigil?: (name: string) => void;
  onNavigateToAbsPath?: (path: string[]) => void;
  keybindings?: Record<string, string>;
  findReferencesName?: string | null;
  onFindReferencesClear?: () => void;
}

const themeCompartment = new Compartment();
const siblingCompartment = new Compartment();
const keymapCompartment = new Compartment();
const wrapCompartment = new Compartment();

const frontMatterLineMark = Decoration.line({ class: "cm-front-matter" });

const toggleFrontmatter = StateEffect.define<boolean>();

class FrontmatterSummaryWidget extends WidgetType {
  constructor(private summary: string) { super(); }
  eq(other: FrontmatterSummaryWidget) { return this.summary === other.summary; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-frontmatter-collapsed";
    span.textContent = this.summary;
    return span;
  }
  ignoreEvent() { return false; }
}

function extractFrontmatterSummary(doc: { line: (n: number) => { text: string } }, closeLineNum: number): string {
  const tuples: string[] = [];
  for (let i = 2; i < closeLineNum; i++) {
    const text = doc.line(i).text.trim();
    if (text) tuples.push(text);
  }
  if (tuples.length === 0) return "---";
  return tuples.length === 1 ? tuples[0] : tuples[0] + " ...";
}

function buildFrontMatterExtension() {
  const collapsed = StateField.define<boolean>({
    create: () => true,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(toggleFrontmatter)) return e.value;
      }
      return value;
    },
  });

  const decorations = StateField.define<DecorationSet>({
    create(state) { return buildDecos(state, true); },
    update(_, tr) {
      return buildDecos(tr.state, tr.state.field(collapsed));
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  function buildDecos(state: EditorState, isCollapsed: boolean): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const closeLineNum = getFrontMatterEnd(state.doc);
    if (closeLineNum === -1) return builder.finish();

    if (isCollapsed) {
      const summary = extractFrontmatterSummary(state.doc, closeLineNum);
      const from = state.doc.line(1).from;
      const to = state.doc.line(closeLineNum).to;
      builder.add(from, to, Decoration.replace({
        widget: new FrontmatterSummaryWidget(summary),
      }));
    } else {
      for (let i = 1; i <= closeLineNum; i++) {
        const line = state.doc.line(i);
        builder.add(line.from, line.from, frontMatterLineMark);
      }
    }
    return builder.finish();
  }

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const isCollapsed = view.state.field(collapsed);
      const closeLineNum = getFrontMatterEnd(view.state.doc);
      if (closeLineNum === -1) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const fmEnd = view.state.doc.line(closeLineNum).to;

      if (isCollapsed && pos <= fmEnd) {
        // Click on collapsed widget — expand
        event.preventDefault();
        view.dispatch({ effects: toggleFrontmatter.of(false) });
        return true;
      }

      if (!isCollapsed && pos > fmEnd) {
        // Click outside frontmatter — collapse
        view.dispatch({ effects: toggleFrontmatter.of(true) });
        return false;
      }

      return false;
    },
  });

  return [collapsed, decorations, clickHandler];
}






/** Find a status value in front matter at the cursor position. */
function findStatusAtCursor(view: EditorView): { value: string; from: number } | null {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const closeLineNum = getFrontMatterEnd(doc);
  if (closeLineNum === -1) return null;
  const line = doc.lineAt(pos);
  if (line.number < 1 || line.number > closeLineNum) return null;
  const match = line.text.match(/^status:\s*(\S+)/);
  if (!match) return null;
  const valueStart = line.from + line.text.indexOf(match[1], line.text.indexOf(":") + 1);
  return { value: match[1], from: valueStart };
}

interface ReferenceHit {
  contextName: string;
  contextPath: string[];
  line: string;
}

function findAllReferences(ctx: Context, symbolName: string, path: string[]): ReferenceHit[] {
  const results: ReferenceHit[] = [];
  const lines = ctx.domain_language.split("\n");
  for (const line of lines) {
    let match;
    allRefsPattern.lastIndex = 0;
    while ((match = allRefsPattern.exec(line)) !== null) {
      if (isInCodeSpan(line, match.index)) continue;
      const text = match[0];
      let refName: string;
      if (text.startsWith("@")) {
        const parts = text.slice(1).split("@");
        const lastPart = parts[parts.length - 1];
        const propMatch = lastPart.search(/[#!]/);
        if (propMatch >= 0) parts[parts.length - 1] = lastPart.slice(0, propMatch);
        refName = parts[parts.length - 1];
      } else if (text.startsWith("#")) {
        refName = fromDashForm(text.slice(1));
      } else {
        refName = fromDashForm(text.slice(1));
      }
      if (flattenName(refName) === flattenName(symbolName) || resolveRefName(refName, [symbolName]) !== undefined) {
        results.push({ contextName: ctx.name, contextPath: path, line: line.trim() });
        break;
      }
    }
  }
  for (const child of ctx.children) {
    results.push(...findAllReferences(child, symbolName, [...path, child.name]));
  }
  return results;
}

let globalPendingStatusRename: string | null = null;

type RenameTarget = { oldName: string; x: number; y: number; kind: "sigil" | "affordance" | "invariant" };
type SetRenameState = (s: RenameTarget | null) => void;
type SetRefsState = (s: { hits: ReferenceHit[]; x: number; y: number } | null) => void;

function buildCustomKeymap(
  kb: Record<string, string>,
  setRenameState: SetRenameState,
  setRefsState: SetRefsState,
  onCreateSigilRef: React.MutableRefObject<((name: string) => void) | undefined>,
  onCreateAffordanceRef: React.MutableRefObject<((name: string) => void) | undefined>,
  onCreateInvariantRef: React.MutableRefObject<((name: string) => void) | undefined>,
  onRenameStatusRef: React.MutableRefObject<((oldValue: string, newValue: string) => void) | undefined>,
) {
  return keymap.of([
    {
      key: kb["rename-sigil"] || "Alt-Mod-r",
      run: (view) => {
        const status = findStatusAtCursor(view);
        if (status) {
          globalPendingStatusRename = status.value;
          view.dispatch({ selection: { anchor: status.from, head: status.from + status.value.length } });
          return true;
        }
        // Check for #affordance or !invariant at cursor
        const prop = findPropertyRefAtCursor(view);
        if (prop?.exists) {
          const pos = view.state.selection.main.head;
          const coords = view.coordsAtPos(pos);
          const rect = view.dom.getBoundingClientRect();
          if (coords) setRenameState({ oldName: prop.name, x: coords.left - rect.left, y: coords.bottom - rect.top + 4, kind: prop.kind });
          return true;
        }
        // Check for @sigil at cursor
        const ref = findRefAtCursor(view);
        if (ref?.known) {
          const coords = view.coordsAtPos(ref.from);
          const rect = view.dom.getBoundingClientRect();
          if (coords) setRenameState({ oldName: ref.name, x: coords.left - rect.left, y: coords.bottom - rect.top + 4, kind: "sigil" });
          return true;
        }
        return false;
      },
    },
    {
      key: "Enter",
      run: (view) => {
        const status = findStatusAtCursor(view);
        if (globalPendingStatusRename !== null) {
          // Completing a rename-shortcut flow
          const oldValue = globalPendingStatusRename;
          globalPendingStatusRename = null;
          if (status && status.value !== oldValue && onRenameStatusRef.current) {
            onRenameStatusRef.current(oldValue, status.value);
          }
          return true;
        }
        // Direct edit: cursor is on status line — propagate to children
        if (status && onRenameStatusRef.current) {
          onRenameStatusRef.current("", status.value);
          return true;
        }
        return false;
      },
    },
    {
      key: "Escape",
      run: () => {
        if (globalPendingStatusRename === null) return false;
        globalPendingStatusRename = null;
        return false;
      },
    },
    {
      key: kb["create-sigil"] || "Alt-Enter",
      run: (view) => {
        const prop = findPropertyRefAtCursor(view);
        if (prop && !prop.exists) {
          if (prop.kind === "affordance" && onCreateAffordanceRef.current) {
            onCreateAffordanceRef.current(prop.name);
            return true;
          }
          if (prop.kind === "invariant" && onCreateInvariantRef.current) {
            onCreateInvariantRef.current(prop.name);
            return true;
          }
        }
        const ref = findRefAtCursor(view);
        if (ref && !ref.known && onCreateSigilRef.current) {
          onCreateSigilRef.current(ref.name);
          return true;
        }
        return false;
      },
    },
    {
      key: kb["find-references"] || "Alt-Mod-f",
      run: (view) => {
        let symbolName: string | null = null;
        const ref = findRefAtCursor(view);
        if (ref?.known) {
          symbolName = ref.name;
        } else {
          const prop = findPropertyRefAtCursor(view);
          if (prop) symbolName = fromDashForm(prop.name);
        }
        const sigilRoot = getGlobalSigilRoot();
        if (!symbolName || !sigilRoot) return false;
        const hits = findAllReferences(sigilRoot, symbolName, []);
        if (hits.length === 0) return false;
        const pos = view.state.selection.main.head;
        const coords = view.coordsAtPos(pos);
        const rect = view.dom.getBoundingClientRect();
        if (coords) setRefsState({ hits, x: coords.left - rect.left, y: coords.bottom - rect.top + 4 });
        return true;
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

export function MarkdownEditor({ content, onChange, siblingNames = [], siblings = [], sigilRoot, currentContext, currentPath = [], wordWrap = false, onCreateSigil, onCreateAffordance, onCreateInvariant, onRenameSigil, onRenameProperty, onRenameStatus, onNavigateToSigil, onNavigateToAbsPath, keybindings = {}, findReferencesName, onFindReferencesClear }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateSigilRef = useRef(onCreateSigil);
  onCreateSigilRef.current = onCreateSigil;
  const onCreateAffordanceRef = useRef(onCreateAffordance);
  onCreateAffordanceRef.current = onCreateAffordance;
  const onCreateInvariantRef = useRef(onCreateInvariant);
  onCreateInvariantRef.current = onCreateInvariant;
  const onRenameSigilRef = useRef(onRenameSigil);
  onRenameSigilRef.current = onRenameSigil;
  const onRenamePropertyRef = useRef(onRenameProperty);
  onRenamePropertyRef.current = onRenameProperty;
  const onNavigateRef = useRef(onNavigateToSigil);
  onNavigateRef.current = onNavigateToSigil;
  const onNavigateAbsPathRef = useRef(onNavigateToAbsPath);
  onNavigateAbsPathRef.current = onNavigateToAbsPath;
  const [renameState, setRenameState] = useState<RenameTarget | null>(null);
  const [refsState, setRefsStateRaw] = useState<{ hits: ReferenceHit[]; x: number; y: number } | null>(null);
  const [refsIndex, setRefsIndex] = useState(0);
  const setRefsState: SetRefsState = (s) => { setRefsStateRaw(s); setRefsIndex(0); };
  const onRenameStatusRef = useRef(onRenameStatus);
  onRenameStatusRef.current = onRenameStatus;
  onChangeRef.current = onChange;
  const localEditRef = useRef(false);
  const lastLocalContentRef = useRef<string | null>(null);
  const prevPathRef = useRef<string>(currentPath.join("/"));

  useEffect(() => {
    if (!findReferencesName || !sigilRoot) return;
    onFindReferencesClear?.();
    const hits = findAllReferences(sigilRoot, findReferencesName, []);
    if (hits.length === 0) return;
    // Position at top-left of editor since there's no cursor context
    setRefsState({ hits, x: 32, y: 32 });
  }, [findReferencesName]);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymapCompartment.of(buildCustomKeymap(keybindings, setRenameState, setRefsState, onCreateSigilRef, onCreateAffordanceRef, onCreateInvariantRef, onRenameStatusRef)),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        siblingCompartment.of(buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null, currentPath)),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        buildFrontMatterExtension(),
        autocompletion({
          override: [siblingCompletion],
          activateOnTyping: true,
          activateOnTypingDelay: 0,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            localEditRef.current = true;
            lastLocalContentRef.current = text;
            onChangeRef.current(text);
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (event.key === "Meta" || event.key === "Control") {
              view.dom.classList.add("cm-cmd-held");
            }
            return false;
          },
          keyup: (event, view) => {
            if (event.key === "Meta" || event.key === "Control") {
              view.dom.classList.remove("cm-cmd-held");
            }
            return false;
          },
          blur: (_event, view) => {
            view.dom.classList.remove("cm-cmd-held");
            return false;
          },
          mousedown: (event, view) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos);
            // Use the same pattern as the highlighter — handles @sigil, #affordance, !invariant
            const clickPattern = new RegExp(allRefsPattern.source, "g");
            let match;
            while ((match = clickPattern.exec(line.text)) !== null) {
              const from = line.from + match.index;
              const to = from + match[0].length;
              if (pos >= from && pos <= to) {
                const matchText = match[0];
                if (matchText.startsWith("@")) {
                  // @sigil ref — strip property suffix, navigate to the sigil
                  const propIdx = findPropSeparator(matchText);
                  const sigilRef = propIdx === -1 ? matchText : matchText.slice(0, propIdx);
                  const resolution = resolveChainedRef(sigilRef);
                  if (onNavigateAbsPathRef.current && resolution.absolutePath !== undefined) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(resolution.absolutePath);
                    return true;
                  }
                  if (resolution.kind === "absolute" && onNavigateAbsPathRef.current) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(resolution.path);
                    return true;
                  }
                  if ((resolution.kind === "contained" || resolution.kind === "sibling") && onNavigateRef.current) {
                    event.preventDefault();
                    onNavigateRef.current(resolution.path[0]);
                    return true;
                  }
                } else if (matchText.startsWith("!")) {
                  // !invariant — navigate to the owning sigil
                  const result = findInvariantInScopeLocal(matchText.slice(1));
                  if (result && onNavigateAbsPathRef.current) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(result.ownerPath);
                    return true;
                  }
                } else if (matchText.startsWith("#")) {
                  // #affordance — navigate to the owning sigil
                  const result = findAffordanceInScopeLocal(matchText.slice(1));
                  if (result && onNavigateAbsPathRef.current) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(result.ownerPath);
                    return true;
                  }
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
          ".cm-front-matter": {
            opacity: "0.45",
            fontSize: "0.8em",
            fontStyle: "italic",
            color: "var(--text-secondary)",
          },
          ".cm-frontmatter-collapsed": {
            opacity: "0.45",
            fontSize: "0.8em",
            fontStyle: "italic",
            color: "var(--text-secondary)",
            cursor: "pointer",
          },
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
      effects: keymapCompartment.reconfigure(buildCustomKeymap(keybindings, setRenameState, setRefsState, onCreateSigilRef, onCreateAffordanceRef, onCreateInvariantRef, onRenameStatusRef)),
    });
  }, [keybindings]);

  // Update sibling highlighting when siblings or root change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: siblingCompartment.reconfigure(buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null, currentPath)),
    });
  }, [siblingNames, siblings, sigilRoot, currentContext, currentPath]);

  // Toggle word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  // Sync external content changes into CodeMirror.
  // Two cases: (1) navigation to a different sigil, (2) echo of our own edits.
  // Use currentPath to distinguish — path change always means navigation.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const pathKey = currentPath.join("/");
    const navigated = pathKey !== prevPathRef.current;
    prevPathRef.current = pathKey;

    const currentDoc = view.state.doc.toString();

    if (currentDoc === content) {
      localEditRef.current = false;
      lastLocalContentRef.current = null;
      return;
    }

    // If we have local edits and did NOT navigate, this is a debounced echo — skip.
    if (localEditRef.current && !navigated) {
      return;
    }

    // Navigation to a different sigil, or external reload. Replace content and clear undo history.
    localEditRef.current = false;
    lastLocalContentRef.current = null;
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: content },
      annotations: [Transaction.addToHistory.of(false)],
    });
  }, [content, currentPath]);

  return (
    <div ref={containerRef} className={styles.editor}>
      {!content.trim() && (
        <div className={styles.emptyHint}>
          <span>↑ name affordances</span>
          <span>narrate — name the sigils needed to express them</span>
          <span>↓ declare relevant invariants</span>
        </div>
      )}
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
                if (newName && newName !== renameState.oldName) {
                  if (renameState.kind === "sigil" && onRenameSigilRef.current) {
                    onRenameSigilRef.current(renameState.oldName, newName);
                  } else if ((renameState.kind === "affordance" || renameState.kind === "invariant") && onRenamePropertyRef.current) {
                    onRenamePropertyRef.current(renameState.kind, renameState.oldName, newName);
                  }
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
      {refsState && (
        <div
          className={styles.refsDropdown}
          style={{ left: refsState.x, top: refsState.y }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setRefsIndex((i) => Math.min(i + 1, refsState.hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setRefsIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = refsState.hits[refsIndex];
              if (hit && onNavigateAbsPathRef.current) onNavigateAbsPathRef.current(hit.contextPath);
              setRefsState(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setRefsState(null);
            }
          }}
          onBlur={() => setRefsState(null)}
        >
          {refsState.hits.map((hit, i) => (
            <div
              key={`${hit.contextPath.join("/")}:${i}`}
              className={`${styles.refsItem} ${i === refsIndex ? styles.refsItemActive : ""}`}
              onMouseEnter={() => setRefsIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (onNavigateAbsPathRef.current) onNavigateAbsPathRef.current(hit.contextPath);
                setRefsState(null);
                setRefsIndex(0);
              }}
            >
              <span className={styles.refsContext}>{hit.contextPath.length ? hit.contextPath.join(" > ") : hit.contextName}</span>
              <span className={styles.refsLine}>{hit.line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
