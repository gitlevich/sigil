import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import {
  buildLexicalScope,
  buildScope as buildCoreScope,
  makeSummary,
  type Ref,
  type Sigil,
} from "sigil-core";
import type { SigilFolder } from "../../tauri";
import { useWorkspaceState, useWorkspaceDispatch } from "../../state/WorkspaceContext";
import { getBase, setBase, useAutoSave } from "../../hooks/useAutoSave";
import { useThemeObserver } from "../../hooks/useThemeObserver";
import { MarkdownPreview } from "../Workspace/MarkdownPreview";
import {
  buildScopeHighlighter,
  scopeCompletion,
  getThemeExtension,
  findPropertyRefAtCursor,
  findRefAtCursor,
  type ScopeEntry,
} from "../Workspace/editorScope";
import { resolveCurrentFolder } from "../../state/WorkspaceContext";
import { useActionDeps } from "../../hooks/useActionDeps";
import * as actions from "../../actions/workspace";
import styles from "./VisionEditor.module.css";

const themeCompartment = new Compartment();
const scopeCompartment = new Compartment();

function mapScopeKind(kind: string): ScopeEntry["kind"] {
  if (kind === "lib") return "lib";
  if (kind === "sibling" || kind === "ancestor" || kind === "proximity") return "sibling";
  return "contained";
}

export function buildVisionScope(root: SigilFolder, importedOntologies?: SigilFolder | null): ScopeEntry[] {
  return buildCoreScope(root as Sigil, [], importedOntologies as Sigil | null | undefined).map((item) => ({
    name: item.name,
    summary: makeSummary(item.target),
    kind: mapScopeKind(item.kind),
    absolutePath: item.kind === "lib" ? ["Imported Ontologies", ...item.path] : item.path,
    libPrefix: item.kind === "lib" ? item.path[0] : undefined,
  }));
}

export function buildVisionRefs(root: SigilFolder, scope: ScopeEntry[]): Ref[] {
  const refs = buildLexicalScope(root as Sigil, []);
  const seen = new Set(refs.map((ref) => `${ref.prefix}${ref.name.toLowerCase()}`));
  for (const entry of scope) {
    const key = `@${entry.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      name: entry.name,
      prefix: "@",
      summary: entry.summary,
      navigable: true,
    });
  }
  return refs;
}

function buildVisionHighlighter(scope: ScopeEntry[], root: SigilFolder) {
  const names = scope.map((s) => s.name);
  return buildScopeHighlighter(names, scope, root, root, []);
}

function minimalChange(current: string, next: string) {
  let prefix = 0;
  const maxCommon = Math.min(current.length, next.length);
  while (prefix < maxCommon && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }

  let oldEnd = current.length;
  let newEnd = next.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    current.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }

  return { from: prefix, to: oldEnd, insert: next.slice(prefix, newEnd) };
}

export function VisionEditor() {
  const ws = useWorkspaceState();
  const wsDispatch = useWorkspaceDispatch();
  const { save } = useAutoSave();
  const actionDeps = useActionDeps();
  const visionPath = `${ws.spec.rootPath}/vision.md`;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef<(value: string) => void>(() => {});
  const prevVisionPathRef = useRef(visionPath);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const actionDepsRef = useRef(actionDeps);
  actionDepsRef.current = actionDeps;
  const visionScope = useMemo(
    () => buildVisionScope(ws.spec.root, ws.spec.importedOntologies ?? null),
    [ws.spec.root, ws.spec.importedOntologies],
  );
  const visionRefs = useMemo(
    () => buildVisionRefs(ws.spec.root, visionScope),
    [ws.spec.root, visionScope],
  );
  const visionScopeRef = useRef(visionScope);
  visionScopeRef.current = visionScope;
  const visionRootRef = useRef(ws.spec.root);
  visionRootRef.current = ws.spec.root;

  const handleChange = (value: string) => {
    save(visionPath, value);
    wsDispatch({
      type: "UPDATE_SPEC",
      spec: { ...ws.spec, vision: value },
    });
  };

  onChangeRef.current = handleChange;

  // Create CodeMirror instance
  useEffect(() => {
    if (!containerRef.current) return;

    setBase(visionPath, ws.spec.vision ?? "");

    const state = EditorState.create({
      doc: ws.spec.vision ?? "",
      extensions: [
        highlightActiveLine(),
        history(),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        scopeCompartment.of(buildVisionHighlighter(visionScope, ws.spec.root)),
        autocompletion({
          override: [scopeCompletion],
          activateOnTyping: true,
          activateOnTypingDelay: 150,
        }),
        EditorView.domEventHandlers({
          focus: (_event, view) => {
            view.dispatch({
              effects: scopeCompartment.reconfigure(
                buildVisionHighlighter(visionScopeRef.current, visionRootRef.current),
              ),
            });
            return false;
          },
          keydown: (event, view) => {
            if (event.altKey && event.key === "Enter") {
              const folder = resolveCurrentFolder(wsRef.current);
              if (!folder) return false;
              const prop = findPropertyRefAtCursor(view);
              if (prop && !prop.exists) {
                event.preventDefault();
                if (prop.kind === "affordance") {
                  actions.createAffordance(prop.targetContext ?? folder, prop.name, actionDepsRef.current);
                  return true;
                }
                if (prop.kind === "invariant") {
                  actions.createInvariant(prop.targetContext ?? folder, prop.name, actionDepsRef.current);
                  return true;
                }
              }
              const ref = findRefAtCursor(view);
              if (ref && !ref.known) {
                event.preventDefault();
                actions.createSigil(folder, ref.name, actionDepsRef.current);
                return true;
              }
            }
            return false;
          },
        }),
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

  useThemeObserver(viewRef, themeCompartment);

  // Sync external content from disk reloads. Dirty local buffers take
  // precedence so a reload cannot overwrite active typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const incoming = ws.spec.vision ?? "";
    const pathChanged = visionPath !== prevVisionPathRef.current;
    prevVisionPathRef.current = visionPath;

    if (current === incoming) {
      if (getBase(visionPath) === null) setBase(visionPath, incoming);
      return;
    }

    if (!pathChanged) {
      const base = getBase(visionPath);
      if (base !== null && current !== base) return;
      if (view.hasFocus) return;
    }

    view.dispatch({
      changes: pathChanged
        ? { from: 0, to: current.length, insert: incoming }
        : minimalChange(current, incoming),
      annotations: [Transaction.addToHistory.of(false)],
    });
    setBase(visionPath, incoming);
  }, [ws.spec.vision, visionPath]);

  // Refresh sigil reference highlighting when context changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: scopeCompartment.reconfigure(buildVisionHighlighter(visionScope, ws.spec.root)),
    });
  }, [visionScope, ws.spec.root]);

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
              <MarkdownPreview content={ws.spec.vision} refs={visionRefs} scope={visionScope} />
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
