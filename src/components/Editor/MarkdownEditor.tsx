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
import { Affordance, Context } from "../../tauri";
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
  sigilRoot?: Context;
  currentContext?: Context;
  wordWrap?: boolean;
  onCreateSigil?: (name: string) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onNavigateToSigil?: (name: string) => void;
  onNavigateToAbsPath?: (path: string[]) => void;
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
const absoluteMark = Decoration.mark({ class: "cm-ref-absolute" });
const externalMark = Decoration.mark({ class: "cm-ref-external" });
const affordanceMark = Decoration.mark({ class: "cm-ref-affordance" });
const signalMark = Decoration.mark({ class: "cm-ref-signal" });
const frontMatterLineMark = Decoration.line({ class: "cm-front-matter" });

const FRONT_MATTER_STATUSES = ["idea", "articulated", "defined"];

function getFrontMatterEnd(doc: { lines: number; line: (n: number) => { text: string; from: number; to: number } }): number {
  if (doc.lines < 2 || doc.line(1).text !== "---") return -1;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text === "---") return i;
  }
  return -1;
}

function buildFrontMatterPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const closeLineNum = getFrontMatterEnd(view.state.doc);
        if (closeLineNum === -1) return builder.finish();
        for (let i = 1; i <= closeLineNum; i++) {
          const line = view.state.doc.line(i);
          builder.add(line.from, line.from, frontMatterLineMark);
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

let globalSiblings: SiblingInfo[] = [];
let globalSigilRoot: Context | null = null;
let globalCurrentContext: Context | null = null;

/** Convert affordance name to dash-separated form for use in #references. */
function toDashForm(name: string): string {
  return name.replace(/\s+/g, "-");
}

/** Convert dash-separated #reference back to original affordance name. */
function fromDashForm(dashed: string): string {
  return dashed.replace(/-/g, " ");
}

/** Find an affordance by its dash-form name. */
function findAffordance(ctx: Context | undefined, dashedName: string): Affordance | undefined {
  if (!ctx?.affordances) return undefined;
  const spacedName = fromDashForm(dashedName);
  return ctx.affordances.find((a) => a.name === spacedName || a.name === dashedName);
}

// Matches @Sigil#affordance, @Sigil@Child#affordance, @Sigil, standalone #affordance, and !signal
const allRefsPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:#[a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

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

/** Walk the sigil tree following segments with plural resolution. Returns resolved path or null. */
function walkTree(segments: string[], ctx: Context): string[] | null {
  if (segments.length === 0) return [];
  const canonical = resolveRefName(segments[0], ctx.children.map((c) => c.name));
  if (!canonical) return null;
  const child = ctx.children.find((c) => c.name === canonical)!;
  const rest = walkTree(segments.slice(1), child);
  if (rest === null) return null;
  return [canonical, ...rest];
}

function findContextByPath(path: string[], root: Context): Context | null {
  let ctx: Context = root;
  for (const seg of path) {
    const child = ctx.children.find((c) => c.name === seg);
    if (!child) return null;
    ctx = child;
  }
  return ctx;
}

type RefKind = "contained" | "sibling" | "absolute" | "external" | "unresolved";

interface RefResolution {
  kind: RefKind;
  /** Absolute path from root (for absolute refs), or [name] for local refs. */
  path: string[];
  summary?: string;
}

/** Resolve a matched ref string like "@Sigil@Shaping@Containment" or "@Experience". */
function resolveChainedRef(matchText: string): RefResolution {
  const segments = matchText.slice(1).split("@");

  if (segments.length === 1) {
    // Check if it matches the root sigil name — treat as absolute path to root
    if (globalSigilRoot && resolveRefName(segments[0], [globalSigilRoot.name])) {
      const summary = (globalSigilRoot.domain_language || "").split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
      return { kind: "absolute", path: [], summary };
    }
    const info = findSibling(segments[0]);
    if (info) return { kind: info.kind === "sibling" ? "sibling" : "contained", path: [info.name], summary: info.summary };
    return { kind: "unresolved", path: segments };
  }

  // Multi-segment: first segment must be the root name (absolute path)
  if (!globalSigilRoot) return { kind: "external", path: segments };
  const rootCanonical = resolveRefName(segments[0], [globalSigilRoot.name]);
  if (!rootCanonical) return { kind: "external", path: segments };

  const resolved = walkTree(segments.slice(1), globalSigilRoot);
  if (resolved === null) return { kind: "external", path: segments };

  const ctx = findContextByPath(resolved, globalSigilRoot);
  const summary = ctx ? (ctx.domain_language || "").split("\n").filter((l) => l.trim()).slice(0, 3).join("\n") : undefined;
  return { kind: "absolute", path: resolved, summary };
}

function buildSiblingHighlighter(_names: string[], siblings: SiblingInfo[], sigilRoot: Context | null, currentCtx: Context | null) {
  globalSiblings = siblings;
  globalSigilRoot = sigilRoot;
  globalCurrentContext = currentCtx;

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
              const matchText = match[0];
              const abs = from + match.index;
              if (matchText.startsWith("@")) {
                const hashIdx = matchText.indexOf("#");
                if (hashIdx === -1) {
                  // Pure sigil ref: apply sigil mark to the whole match
                  const resolution = resolveChainedRef(matchText);
                  const mark =
                    resolution.kind === "contained" ? containedMark :
                    resolution.kind === "sibling" ? siblingMark :
                    resolution.kind === "absolute" ? absoluteMark :
                    resolution.kind === "external" ? externalMark :
                    unresolvedMark;
                  builder.add(abs, abs + matchText.length, mark);
                } else {
                  // Affordance ref @Sigil#name — entire ref is one affordance reference
                  builder.add(abs, abs + matchText.length, affordanceMark);
                }
              } else if (matchText.startsWith("!")) {
                // Standalone !signal
                builder.add(abs, abs + matchText.length, signalMark);
              } else {
                // Standalone #affordance
                builder.add(abs, abs + matchText.length, affordanceMark);
              }
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
      ".cm-ref-absolute": {
        borderBottom: "2px solid var(--accent)",
        borderRadius: "1px",
        paddingBottom: "1px",
        opacity: "0.8",
      },
      ".cm-ref-external": {
        color: "var(--text-secondary)",
        fontStyle: "italic",
      },
      ".cm-ref-unresolved": {
        textDecoration: "underline wavy",
        textDecorationColor: "var(--danger)",
        textUnderlineOffset: "3px",
      },
      ".cm-ref-affordance": {
        color: "#a07ce8",
        fontStyle: "italic",
      },
      ".cm-ref-signal": {
        color: "#e8a040",
        fontStyle: "italic",
      },
      ".cm-front-matter": {
        opacity: "0.45",
        fontSize: "0.8em",
        fontStyle: "italic",
        color: "var(--text-secondary)",
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
      const localPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:#[a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;
      let match;
      while ((match = localPattern.exec(text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (pos >= from && pos <= to) {
          const matchText = match[0];
          const hashIdx = matchText.indexOf("#");
          const sigilPart = matchText.startsWith("@")
            ? (hashIdx === -1 ? matchText : matchText.slice(0, hashIdx))
            : null;
          const affordancePart = hashIdx !== -1 ? matchText.slice(hashIdx + 1) : null;

          let displayName = matchText;
          let summary = "";

          if (sigilPart) {
            const resolution = resolveChainedRef(sigilPart);
            if (resolution.kind === "unresolved" || resolution.kind === "external") return null;
            summary = resolution.summary ?? (resolution.kind === "contained" || resolution.kind === "sibling"
              ? (globalSiblings.find((s) => s.name === resolution.path[0])?.summary ?? "")
              : "");
            if (affordancePart) {
              // Find the affordance content in the resolved context
              const ctx = resolution.kind === "absolute"
                ? findContextByPath(resolution.path, globalSigilRoot!)
                : globalSiblings.find((s) => s.name === resolution.path[0]) as unknown as Context | undefined;
              const aff = findAffordance(ctx as Context | undefined, affordancePart);
              if (aff) summary = aff.content.split("\n").slice(0, 3).join("\n");
              displayName = `${sigilPart}#${affordancePart}`;
            }
          } else if (matchText.startsWith("!")) {
            // standalone !signal — look up in current context
            if (!globalCurrentContext) return null;
            const signalName = matchText.slice(1);
            const signal = globalCurrentContext.signals.find(
              (c) => c.name === signalName || c.name === fromDashForm(signalName)
            );
            if (!signal) return null;
            displayName = matchText;
            summary = signal.content.split("\n").slice(0, 3).join("\n");
          } else {
            // standalone #affordance — look up in current context
            if (!globalCurrentContext) return null;
            const aff = findAffordance(globalCurrentContext, matchText.slice(1));
            if (!aff) return null;
            displayName = matchText;
            summary = aff.content.split("\n").slice(0, 3).join("\n");
          }

          return {
            pos: from,
            end: to,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "cm-tooltip-sibling";
              const nameEl = document.createElement("div");
              nameEl.className = "cm-tooltip-sibling-name";
              nameEl.textContent = displayName;
              dom.appendChild(nameEl);
              if (summary) {
                const summaryEl = document.createElement("div");
                summaryEl.className = "cm-tooltip-sibling-summary";
                summaryEl.textContent = summary;
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

/** Find any context in the tree whose name matches (case-insensitive). */
function findContextByName(name: string, root: Context): Context | null {
  if (resolveRefName(name, [root.name])) return root;
  for (const child of root.children) {
    const found = findContextByName(name, child);
    if (found) return found;
  }
  return null;
}

/** Resolve a sigil ref string to its Context node, or null if unresolvable. */
function resolveRefToContext(sigilRef: string): Context | null {
  if (!globalSigilRoot) return null;
  const resolution = resolveChainedRef(sigilRef);
  if (resolution.kind === "absolute") return findContextByPath(resolution.path, globalSigilRoot);
  if (resolution.kind === "contained" || resolution.kind === "sibling") {
    return findContextByName(resolution.path[0], globalSigilRoot);
  }
  return null;
}

function siblingCompletion(context: CompletionContext) {
  // Front matter: offer status values when inside the --- block
  const closeLineNum = getFrontMatterEnd(context.state.doc);
  if (closeLineNum !== -1) {
    const curLine = context.state.doc.lineAt(context.pos);
    if (curLine.number >= 1 && curLine.number <= closeLineNum) {
      const statusMatch = context.matchBefore(/status:\s*\w*/);
      if (statusMatch) {
        return {
          from: context.state.doc.lineAt(context.pos).from + curLine.text.indexOf(":") + 1,
          options: FRONT_MATTER_STATUSES.map((s) => ({ label: ` ${s}`, type: "keyword" as const })),
          filter: false,
        };
      }
      const keyMatch = context.matchBefore(/\w*/);
      if (keyMatch && keyMatch.text.length > 0) {
        return {
          from: keyMatch.from,
          options: [{ label: "status", type: "keyword" as const }],
          filter: true,
        };
      }
      return null;
    }
  }

  // Case 0: standalone #partial — offer current context's own affordances
  const standaloneHash = context.matchBefore(/#(?:[a-zA-Z_][\w-]*)?/);
  if (standaloneHash) {
    // Only trigger if the # is not preceded by @ (that's Case 1)
    const lineText = context.state.doc.lineAt(standaloneHash.from).text;
    const colOfHash = standaloneHash.from - context.state.doc.lineAt(standaloneHash.from).from;
    const charBefore = colOfHash > 0 ? lineText[colOfHash - 1] : "";
    const isAfterSigil = /[\w-]/.test(charBefore);
    if (!isAfterSigil && globalCurrentContext && globalCurrentContext.affordances.length > 0) {
      return {
        from: standaloneHash.from,
        options: globalCurrentContext.affordances.map((a) => ({
          label: `#${toDashForm(a.name)}`,
          detail: a.content.split("\n")[0]?.slice(0, 50) || "",
          type: "property" as const,
        })),
        filter: true,
      };
    }
  }

  // Case 0b: standalone !partial — offer current context's own signals
  const standaloneBang = context.matchBefore(/!(?:[a-zA-Z_][\w-]*)?/);
  if (standaloneBang) {
    const lineText = context.state.doc.lineAt(standaloneBang.from).text;
    const colOfBang = standaloneBang.from - context.state.doc.lineAt(standaloneBang.from).from;
    const charBefore = colOfBang > 0 ? lineText[colOfBang - 1] : "";
    const isAfterWord = /[\w-]/.test(charBefore);
    if (!isAfterWord && globalCurrentContext && globalCurrentContext.signals.length > 0) {
      return {
        from: standaloneBang.from,
        options: globalCurrentContext.signals.map((c) => ({
          label: `!${toDashForm(c.name)}`,
          detail: c.content.split("\n")[0]?.slice(0, 50) || "",
          type: "property" as const,
        })),
        filter: true,
      };
    }
  }

  // Case 1: @Sigil#partial or @Root@Child#partial — offer affordance names
  const beforeAffordance = context.matchBefore(/@(?:[a-zA-Z_][\w-]*@)*[a-zA-Z_][\w-]*#(?:[a-zA-Z_][\w-]*)?/);
  if (beforeAffordance) {
    const text = beforeAffordance.text;
    const hashIdx = text.indexOf("#");
    const sigilRef = text.slice(0, hashIdx);
    const ctx = resolveRefToContext(sigilRef);
    if (ctx && ctx.affordances.length > 0) {
      return {
        from: beforeAffordance.from,
        options: ctx.affordances.map((a) => ({
          label: `${sigilRef}#${toDashForm(a.name)}`,
          detail: a.content.split("\n")[0]?.slice(0, 50) || "",
          type: "property" as const,
        })),
        filter: true,
      };
    }
    return null;
  }

  // Case 2: @A@B@C chains or bare @ — offer sigil names / children
  const before = context.matchBefore(/@(?:[a-zA-Z_][\w-]*@)*(?:[a-zA-Z_][\w-]*)?/);
  if (!before) return null;

  const typed = before.text;
  const segments = typed.slice(1).split("@");

  // Single segment — offer local siblings
  if (segments.length <= 1) {
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

  // Multi-segment — resolve prefix, offer children
  if (!globalSigilRoot) return null;
  const prefix = segments.slice(0, -1);

  const rootCanonical = resolveRefName(prefix[0], [globalSigilRoot.name]);
  if (!rootCanonical) return null;

  let ctx: Context = globalSigilRoot;
  const resolvedParts: string[] = [rootCanonical];
  for (const seg of prefix.slice(1)) {
    const canonical = resolveRefName(seg, ctx.children.map((c) => c.name));
    if (!canonical) return null;
    const child = ctx.children.find((c) => c.name === canonical)!;
    resolvedParts.push(canonical);
    ctx = child;
  }

  const prefixStr = "@" + resolvedParts.join("@") + "@";
  const options: { label: string; detail: string; type: "variable" | "property" }[] = [];

  // Offer child sigils
  for (const child of ctx.children) {
    options.push({
      label: `${prefixStr}${child.name}`,
      detail: (child.domain_language || "").split("\n").filter((l) => l.trim())[0]?.slice(0, 50) || "",
      type: "variable",
    });
  }

  // Also offer affordances of the resolved context via #
  const sigilRefStr = "@" + resolvedParts.join("@");
  for (const aff of ctx.affordances) {
    options.push({
      label: `${sigilRefStr}#${toDashForm(aff.name)}`,
      detail: aff.content.split("\n")[0]?.slice(0, 50) || "",
      type: "property",
    });
  }

  if (options.length === 0) return null;
  return { from: before.from, options, filter: true };
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

export function MarkdownEditor({ content, onChange, siblingNames = [], siblings = [], sigilRoot, currentContext, wordWrap = false, onCreateSigil, onRenameSigil, onNavigateToSigil, onNavigateToAbsPath, keybindings = {} }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateSigilRef = useRef(onCreateSigil);
  onCreateSigilRef.current = onCreateSigil;
  const onRenameSigilRef = useRef(onRenameSigil);
  onRenameSigilRef.current = onRenameSigil;
  const onNavigateRef = useRef(onNavigateToSigil);
  onNavigateRef.current = onNavigateToSigil;
  const onNavigateAbsPathRef = useRef(onNavigateToAbsPath);
  onNavigateAbsPathRef.current = onNavigateToAbsPath;
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
        siblingCompartment.of(buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null)),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        buildFrontMatterPlugin(),
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
            // Include optional #affordance suffix so clicking anywhere in @Sigil#aff navigates
            const refPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:#[a-zA-Z_][\w-]*)?/g;
            let match;
            while ((match = refPattern.exec(line.text)) !== null) {
              const from = line.from + match.index;
              const to = from + match[0].length;
              if (pos >= from && pos <= to) {
                // Strip #affordance before resolving — navigation targets the sigil, not the affordance
                const hashIdx = match[0].indexOf("#");
                const sigilRef = hashIdx === -1 ? match[0] : match[0].slice(0, hashIdx);
                const resolution = resolveChainedRef(sigilRef);
                if (resolution.kind === "absolute" && onNavigateAbsPathRef.current) {
                  onNavigateAbsPathRef.current(resolution.path);
                  event.preventDefault();
                  return true;
                }
                if ((resolution.kind === "contained" || resolution.kind === "sibling") && onNavigateRef.current) {
                  onNavigateRef.current(resolution.path[0]);
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

  // Update sibling highlighting when siblings or root change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: siblingCompartment.reconfigure(buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null)),
    });
  }, [siblingNames, siblings, sigilRoot, currentContext]);

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
      {!content.trim() && (
        <div className={styles.emptyHint}>
          <span>↑ name affordances</span>
          <span>narrate — name the sigils needed to express them</span>
          <span>↓ declare relevant signals</span>
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
