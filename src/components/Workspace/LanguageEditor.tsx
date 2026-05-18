import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, Transaction, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  Decoration, DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { SigilFolder, api, events } from "../../tauri";
import { getBase, setBase } from "../../hooks/useAutoSave";
import { RenamePopup } from "../shared/RenamePopup";
import { RefsDropdown } from "../shared/RefsDropdown";
import { fromDashForm } from "sigil-core";
import {
  ScopeEntry,
  scopeCompletion,
  buildScopeHighlighter,
  buildCollapsibleFrontmatter,
  getThemeExtension,
  allRefsPattern,
  findPropSeparator,
  resolveFromEditor,
  findRefAtCursor,
  findPropertyRefAtCursor,
  getFrontMatterEnd,
  getGlobalSigilRoot,
  findInvariantFromEditor,
  findAffordanceFromEditor,
  findAllReferencesInTree,
  navigationPathForResolution,
} from "./editorScope";
import { useThemeObserver } from "../../hooks/useThemeObserver";
import styles from "./LanguageEditor.module.css";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

export function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

async function insertImagesFromClipboard(files: FileList, view: EditorView, sigilDir: string): Promise<void> {
  const assetsDir = `${sigilDir}/assets`;
  const insertions: string[] = [];
  for (const file of Array.from(files)) {
    const name = file.name || "clipboard.png";
    if (!isImageFile(name)) continue;
    const buffer = await file.arrayBuffer();
    const data = Array.from(new Uint8Array(buffer));
    const destPath = `${assetsDir}/${name}`;
    const filename = await api.writeImageBytes(destPath, data);
    insertions.push(`![](assets/${filename})`);
  }
  if (insertions.length === 0) return;
  const text = insertions.join("\n") + "\n";
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
}

interface LanguageEditorProps {
  content: string;
  onChange: (content: string) => void;
  scopeNames?: string[];
  scope?: ScopeEntry[];
  sigilRoot?: SigilFolder;
  currentContext?: SigilFolder;
  currentPath?: string[];
  sigilDir?: string;
  wordWrap?: boolean;
  onCreateSigil?: (name: string) => void;
  onCreateAffordance?: (name: string, target?: SigilFolder) => void;
  onCreateInvariant?: (name: string, target?: SigilFolder) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onRenameProperty?: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onRenameStatus?: (oldValue: string, newValue: string) => void;
  onNavigateToSigil?: (name: string) => void;
  onNavigateToAbsPath?: (path: string[]) => void;
  keybindings?: Record<string, string>;
  findReferencesName?: string | null;
  onFindReferencesClear?: () => void;
  goToLine?: number | null;
  onGoToLineDone?: () => void;
}

const themeCompartment = new Compartment();
const scopeCompartment = new Compartment();
const keymapCompartment = new Compartment();
const wrapCompartment = new Compartment();

// AI-initiated text highlight (translucent yellow)
const setAiHighlight = StateEffect.define<{ from: number; to: number } | null>();
const aiHighlightMark = Decoration.mark({ class: "cm-ai-highlight" });

const aiHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAiHighlight)) {
        if (!e.value) return Decoration.none;
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(e.value.from, e.value.to, aiHighlightMark);
        return builder.finish();
      }
    }
    // Clear on any user edit
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});




/** Find a status value in front matter at the cursor position. */
export function findStatusAtCursor(view: EditorView): { value: string; from: number } | null {
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

let globalPendingStatusRename: string | null = null;

type RenameTarget = { oldName: string; x: number; y: number; kind: "sigil" | "affordance" | "invariant" };
type SetRenameState = (s: RenameTarget | null) => void;
type SetRefsState = (s: { hits: { contextName: string; contextPath: string[]; line: string }[]; x: number; y: number } | null) => void;

export function buildCustomKeymap(
  kb: Record<string, string>,
  setRenameState: SetRenameState,
  setRefsState: SetRefsState,
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
        // Enter inside frontmatter always inserts a newline.
        // Status propagation happens via Alt+Cmd+R rename flow.
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
        const hits = findAllReferencesInTree(sigilRoot, symbolName, []);
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

export function LanguageEditor({ content, onChange, scopeNames = [], scope = [], sigilRoot, currentContext, currentPath = [], sigilDir, wordWrap = false, onCreateSigil, onCreateAffordance, onCreateInvariant, onRenameSigil, onRenameProperty, onRenameStatus, onNavigateToSigil, onNavigateToAbsPath, keybindings = {}, findReferencesName, onFindReferencesClear, goToLine, onGoToLineDone }: LanguageEditorProps) {
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
  const [refsState, setRefsState] = useState<{ hits: { contextName: string; contextPath: string[]; line: string }[]; x: number; y: number } | null>(null);
  const onRenameStatusRef = useRef(onRenameStatus);
  onRenameStatusRef.current = onRenameStatus;
  const sigilDirRef = useRef(sigilDir);
  sigilDirRef.current = sigilDir;
  onChangeRef.current = onChange;
  const prevPathRef = useRef<string>(currentPath.join("/"));

  useEffect(() => {
    if (!findReferencesName || !sigilRoot) return;
    onFindReferencesClear?.();
    const hits = findAllReferencesInTree(sigilRoot, findReferencesName, []);
    if (hits.length === 0) return;
    // Position at top-left of editor since there's no cursor context
    setRefsState({ hits, x: 32, y: 32 });
  }, [findReferencesName]);

  // Scroll to a specific line when requested (e.g. from compile error navigation).
  // Uses requestAnimationFrame to ensure the EditorView is mounted after navigation.
  useEffect(() => {
    if (goToLine == null) return;
    const tryScroll = () => {
      const view = viewRef.current;
      if (!view) return;
      const line = Math.min(goToLine, view.state.doc.lines);
      const lineInfo = view.state.doc.line(line);
      view.dispatch({
        selection: { anchor: lineInfo.from },
        scrollIntoView: true,
      });
      view.focus();
      onGoToLineDone?.();
    };
    // Defer to let the editor mount if we just navigated
    requestAnimationFrame(() => requestAnimationFrame(tryScroll));
  }, [goToLine]);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymapCompartment.of(buildCustomKeymap(keybindings, setRenameState, setRefsState, onRenameStatusRef)),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        scopeCompartment.of(buildScopeHighlighter(scopeNames, scope, sigilRoot ?? null, currentContext ?? null, currentPath)),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        buildCollapsibleFrontmatter(),
        aiHighlightField,
        autocompletion({
          override: [scopeCompletion],
          activateOnTyping: true,
          activateOnTypingDelay: 150,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (event.key === "Meta" || event.key === "Control") {
              view.dom.classList.add("cm-cmd-held");
            }
            // Alt-Enter: create sigil/affordance/invariant from unresolved ref
            if (event.altKey && event.key === "Enter") {
              const prop = findPropertyRefAtCursor(view);
              if (prop && !prop.exists) {
                event.preventDefault();
                if (prop.kind === "affordance" && onCreateAffordanceRef.current) {
                  onCreateAffordanceRef.current(prop.name, prop.targetContext);
                  return true;
                }
                if (prop.kind === "invariant" && onCreateInvariantRef.current) {
                  onCreateInvariantRef.current(prop.name, prop.targetContext);
                  return true;
                }
              }
              const ref = findRefAtCursor(view);
              if (ref && !ref.known && onCreateSigilRef.current) {
                event.preventDefault();
                onCreateSigilRef.current(ref.name);
                return true;
              }
            }
            return false;
          },
          keyup: (event, view) => {
            if (event.key === "Meta" || event.key === "Control") {
              view.dom.classList.remove("cm-cmd-held");
            }
            return false;
          },
          paste: (event, view) => {
            const files = event.clipboardData?.files;
            const dir = sigilDirRef.current;
            if (!files || files.length === 0 || !dir) return false;
            if (!Array.from(files).some((f) => isImageFile(f.name || "clipboard.png"))) return false;
            event.preventDefault();
            insertImagesFromClipboard(files, view, dir);
            return true;
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
                  const resolution = resolveFromEditor(sigilRef);
                  const navigationPath = navigationPathForResolution(resolution);
                  if (onNavigateAbsPathRef.current && navigationPath) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(navigationPath);
                    return true;
                  }
                  if ((resolution.kind === "contained" || resolution.kind === "sibling") && onNavigateRef.current) {
                    event.preventDefault();
                    onNavigateRef.current(resolution.path[0]);
                    return true;
                  }
                } else if (matchText.startsWith("!")) {
                  // !invariant — navigate to the owning sigil
                  const result = findInvariantFromEditor(matchText.slice(1));
                  if (result && onNavigateAbsPathRef.current) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(result.ownerPath);
                    return true;
                  }
                } else if (matchText.startsWith("#")) {
                  // #affordance — navigate to the owning sigil
                  const result = findAffordanceFromEditor(matchText.slice(1));
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
          ".cm-ai-highlight": {
            backgroundColor: "rgba(227, 97, 113, 0.35)",
            borderRadius: "2px",
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

  useThemeObserver(viewRef, themeCompartment);

  // Handle image drops (OS file drops via HTML5 drag-and-drop)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      const view = viewRef.current;
      const dir = sigilDirRef.current;
      if (!files || files.length === 0 || !view || !dir) return;
      if (!Array.from(files).some((f) => isImageFile(f.name))) return;
      e.preventDefault();
      insertImagesFromClipboard(files, view, dir);
    };
    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("drop", handleDrop);
    return () => {
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("drop", handleDrop);
    };
  }, []);

  // Listen for select-text and replace-selected-text events from AI tools
  useEffect(() => {
    const unlistenSelect = events.onSelectText((payload: string) => {
      const view = viewRef.current;
      if (!view) return;
      const data = JSON.parse(payload);
      const doc = view.state.doc;

      let from = -1, to = -1;
      if (data.excerpt) {
        const text = doc.toString();
        const idx = text.indexOf(data.excerpt);
        if (idx !== -1) { from = idx; to = idx + data.excerpt.length; }
      } else if (data.from_line != null) {
        const fromLine = Math.max(1, Math.min(data.from_line, doc.lines));
        const toLine = Math.max(fromLine, Math.min(data.to_line ?? data.from_line, doc.lines));
        from = doc.line(fromLine).from;
        to = doc.line(toLine).to;
      }
      if (from >= 0 && to >= 0) {
        view.dispatch({
          selection: { anchor: from },
          effects: setAiHighlight.of({ from, to }),
          scrollIntoView: true,
        });
        view.focus();
      }
    });

    const unlistenReplace = events.onToolReplaceSelectedText(async ({ request_id, payload }) => {
      const reply = (ok: boolean, message: string) => {
        api.toolResult(request_id, ok, message).catch((err) => {
          console.error("[tool:replace_selected_text] toolResult failed:", err);
        });
      };
      const view = viewRef.current;
      if (!view) {
        reply(false, "no active editor for the current sigil");
        return;
      }
      // Use AI highlight range if present, fall back to user selection.
      const highlight = view.state.field(aiHighlightField);
      let from = -1, to = -1;
      highlight.between(0, view.state.doc.length, (a, b) => { from = a; to = b; return false; });
      if (from < 0) {
        from = view.state.selection.main.from;
        to = view.state.selection.main.to;
      }
      if (from === to) {
        reply(false, "no selection to replace — call select_text first");
        return;
      }
      const replacedLen = to - from;
      view.dispatch({
        changes: { from, to, insert: payload.text },
        effects: setAiHighlight.of(null),
      });
      view.focus();
      // Persist immediately. The autosave debounce (500ms) is too slow:
      // the next tool in the same turn (browser_state_inspection,
      // another select_text) reads language.md from disk and would see
      // the pre-replace content. Update the autosave base in lockstep
      // so the editor's reconcile loop doesn't see an apparent disk
      // divergence and re-trigger conflict UI.
      const filePath = sigilDirRef.current ? `${sigilDirRef.current}/language.md` : null;
      if (!filePath) {
        reply(false, "active editor has no sigil path");
        return;
      }
      const newContent = view.state.doc.toString();
      try {
        await api.writeFile(filePath, newContent);
        setBase(filePath, newContent);
        // Read-back excerpt so the agent can verify the persisted bytes
        // match its intent. We re-read from the disk-synced doc rather
        // than echoing payload.text — this catches any disagreement
        // between intended insert and what landed (e.g. a same-path
        // reconcile hitting concurrently).
        const insertEnd = from + payload.text.length;
        const ctxStart = Math.max(0, from - 24);
        const ctxEnd = Math.min(newContent.length, insertEnd + 24);
        const persisted = newContent.slice(ctxStart, ctxEnd).replace(/\n/g, "\\n");
        const lead = ctxStart > 0 ? "..." : "";
        const trail = ctxEnd < newContent.length ? "..." : "";
        reply(
          true,
          `Replaced ${replacedLen} chars with ${payload.text.length}. Persisted excerpt: "${lead}${persisted}${trail}"`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply(false, `wrote-back failed: ${msg}`);
      }
    });

    return () => {
      unlistenSelect.then((fn) => fn());
      unlistenReplace.then((fn) => fn());
    };
  }, []);

  // Reconfigure custom keymap when keybindings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartment.reconfigure(buildCustomKeymap(keybindings, setRenameState, setRefsState, onRenameStatusRef)),
    });
  }, [keybindings]);

  // Update sibling highlighting when siblings or root change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: scopeCompartment.reconfigure(buildScopeHighlighter(scopeNames, scope, sigilRoot ?? null, currentContext ?? null, currentPath)),
    });
  }, [scopeNames, scope, sigilRoot, currentContext, currentPath]);

  // Toggle word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  // Sync external content into CodeMirror.
  // Navigation: replace doc and clear undo.
  // Same-path clean buffer (doc === last-known-disk snapshot): adopt new content silently —
  //   this is the #reconcile-external-changes path for an unedited file.
  // Same-path dirty buffer (doc diverged from snapshot): skip — could be the 300ms debounce
  //   echo, or a real external change that the shell will surface as a conflict.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const pathKey = currentPath.join("/");
    const navigated = pathKey !== prevPathRef.current;
    prevPathRef.current = pathKey;

    const currentDoc = view.state.doc.toString();
    if (currentDoc === content) return;

    if (navigated) {
      // Navigation to a different sigil. Replace content and clear undo history.
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
        annotations: [Transaction.addToHistory.of(false)],
      });
      return;
    }

    // Same path. Decide by buffer dirtiness.
    const filePath = sigilDirRef.current ? `${sigilDirRef.current}/language.md` : null;
    const base = filePath ? getBase(filePath) : null;
    if (base !== null && currentDoc !== base) return; // Dirty buffer — protect unsaved work.
    // base===null path falls through: no snapshot tracked (e.g., in tests or transient states),
    // so we accept the content prop. This matches pre-reconcile behavior.

    // Absolute integrity: never blow the editor away under a live cursor. If the
    // editor is focused, skip the silent adopt — the user is inside this buffer.
    // The next keystroke will re-dispatch and the sync settles on pause.
    if (view.hasFocus) return;

    // Minimal diff — preserves caret and scroll through CodeMirror's position
    // mapping. A full { from:0, to:end } replace resets the caret to 0 and can
    // appear as "my last edit vanished" under upstream races.
    let prefix = 0;
    const maxCommon = Math.min(currentDoc.length, content.length);
    while (prefix < maxCommon && currentDoc.charCodeAt(prefix) === content.charCodeAt(prefix)) prefix++;
    let oldEnd = currentDoc.length;
    let newEnd = content.length;
    while (oldEnd > prefix && newEnd > prefix && currentDoc.charCodeAt(oldEnd - 1) === content.charCodeAt(newEnd - 1)) {
      oldEnd--; newEnd--;
    }
    view.dispatch({
      changes: { from: prefix, to: oldEnd, insert: content.slice(prefix, newEnd) },
      annotations: [Transaction.addToHistory.of(false)],
    });
    if (filePath) setBase(filePath, content);
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
        <RenamePopup
          oldName={renameState.oldName}
          kind={renameState.kind}
          x={renameState.x}
          y={renameState.y}
          onRename={(kind, oldName, newName) => {
            if (kind === "sigil" && onRenameSigilRef.current) {
              onRenameSigilRef.current(oldName, newName);
            } else if ((kind === "affordance" || kind === "invariant") && onRenamePropertyRef.current) {
              onRenamePropertyRef.current(kind, oldName, newName);
            }
          }}
          onClose={() => setRenameState(null)}
        />
      )}
      {refsState && (
        <RefsDropdown
          hits={refsState.hits}
          x={refsState.x}
          y={refsState.y}
          onNavigate={(path) => {
            if (onNavigateAbsPathRef.current) onNavigateAbsPathRef.current(path);
          }}
          onClose={() => setRefsState(null)}
        />
      )}
    </div>
  );
}
