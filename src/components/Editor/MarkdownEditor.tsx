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
  kind?: "contained" | "sibling" | "lib";
  absolutePath?: string[]; // full path from root for navigation
  /** For lib refs, the ontology prefix (e.g. "AttentionLanguage") */
  libPrefix?: string;
}

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
const libMark = Decoration.mark({ class: "cm-ref-lib" });
const unresolvedMark = Decoration.mark({ class: "cm-ref-unresolved" });
const absoluteMark = Decoration.mark({ class: "cm-ref-absolute" });
const externalMark = Decoration.mark({ class: "cm-ref-external" });
const affordanceMark = Decoration.mark({ class: "cm-ref-affordance" });
const invariantMark = Decoration.mark({ class: "cm-ref-invariant" });
const frontMatterLineMark = Decoration.line({ class: "cm-front-matter" });

const DEFAULT_STATUS = "idea";

function extractStatus(domainLanguage: string): string | null {
  if (!domainLanguage.startsWith("---")) return null;
  const end = domainLanguage.indexOf("\n---", 3);
  if (end === -1) return null;
  const match = domainLanguage.slice(3, end).match(/^status:\s*(\S+)/m);
  return match ? match[1] : null;
}


function collectStatusesExcluding(ctx: Context, excludePath: string): string[] {
  if (ctx.path === excludePath) return ctx.children.flatMap((c) => collectStatusesExcluding(c, excludePath));
  const status = extractStatus(ctx.domain_language || "");
  return [
    ...(status ? [status] : []),
    ...ctx.children.flatMap((c) => collectStatusesExcluding(c, excludePath)),
  ];
}

function getKnownStatuses(): string[] {
  const excludePath = globalCurrentContext?.path ?? "";
  const found = globalSigilRoot
    ? collectStatusesExcluding(globalSigilRoot, excludePath)
    : [];
  return [DEFAULT_STATUS, ...found].filter((s, i, arr) => arr.indexOf(s) === i);
}

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
let globalSiblingNames: string[] = [];
/** Precomputed lookup: lowercase name → canonical name, flattened name → canonical name */
let globalNameIndex: Map<string, string> = new Map();
let globalSigilRoot: Context | null = null;
let globalCurrentContext: Context | null = null;
let globalCurrentPath: string[] = [];

/** Collect affordances/invariants from the current context and all ancestors. */
function collectAncestorProperties(root: Context | null, path: string[]) {
  if (!root) return { affordances: [] as { name: string; content: string; source: string }[], invariants: [] as { name: string; content: string; source: string }[] };
  const affordances: { name: string; content: string; source: string }[] = [];
  const invariants: { name: string; content: string; source: string }[] = [];
  // Walk from root down the path, collecting at each level
  let ctx = root;
  for (const a of ctx.affordances) affordances.push({ name: a.name, content: a.content, source: ctx.name });
  for (const d of ctx.invariants) invariants.push({ name: d.name, content: d.content, source: ctx.name });
  for (const seg of path) {
    const child = ctx.children.find((c) => c.name === seg);
    if (!child) break;
    ctx = child;
    for (const a of ctx.affordances) affordances.push({ name: a.name, content: a.content, source: ctx.name });
    for (const d of ctx.invariants) invariants.push({ name: d.name, content: d.content, source: ctx.name });
  }
  return { affordances, invariants };
}

function buildNameIndex(names: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const n of names) {
    index.set(n.toLowerCase(), n);
    index.set(flattenName(n), n);
  }
  return index;
}

function extractSummary(domainLanguage: string): string {
  let text = domainLanguage;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  return text.split("\n")
    .filter((l) => l.trim())
    .slice(0, 3)
    .join("\n");
}

/** Returns true if the character at matchIndex in lineText is inside a backtick code span. */
function isInCodeSpan(lineText: string, matchIndex: number): boolean {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (lineText[i] === "`") count++;
  }
  return count % 2 === 1;
}

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
const allRefsPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

/** Find the index of the property separator (# or !) in an @-reference, or -1 if none. */
function findPropSeparator(refText: string): number {
  // Skip leading @ and segment@segment parts, then look for # or !
  for (let i = 1; i < refText.length; i++) {
    if (refText[i] === "@") continue;
    if (refText[i] === "#" || refText[i] === "!") return i;
    // Skip word chars
    while (i < refText.length && /[\w-]/.test(refText[i])) i++;
    if (i < refText.length && refText[i] === "@") continue;
    if (i < refText.length && (refText[i] === "#" || refText[i] === "!")) return i;
    break;
  }
  return -1;
}

/** Strip spaces, dashes, underscores and lowercase — for fuzzy sigil name matching. */
function flattenName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Resolve a (possibly plural) ref name to the canonical sigil name, or undefined if unknown. */
export function resolveRefName(refName: string, knownNames: string[]): string | undefined {
  const lower = refName.toLowerCase();
  let match = knownNames.find((n) => n.toLowerCase() === lower);
  if (match) return match;
  // CamelCase / dashed / spaced — flatten and compare
  const flat = flattenName(refName);
  match = knownNames.find((n) => flattenName(n) === flat);
  if (match) return match;
  if (lower.endsWith("ies") && lower.length > 3) {
    const stem = lower.slice(0, -3) + "y";
    match = knownNames.find((n) => n.toLowerCase() === stem);
    if (match) return match;
  }
  if (lower.endsWith("s") && lower.length > 1) {
    const stem = lower.slice(0, -1);
    match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
    if (match) return match;
  }
  // Past tense: -ed (collapsed → collapse, attended → attend, observed → observe)
  if (lower.endsWith("ed") && lower.length > 3) {
    // Try dropping -ed (e.g. collapsed → collaps → no, but also check -d for silent-e verbs)
    const stems = [lower.slice(0, -2), lower.slice(0, -1)]; // "collapse" from "collapsed" via -d, "attend" from "attended" via -ed
    for (const stem of stems) {
      match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
      if (match) return match;
    }
  }
  // Present continuous: -ing (collapsing → collapse, attending → attend, observing → observe)
  if (lower.endsWith("ing") && lower.length > 4) {
    // Try dropping -ing, and dropping -ing + adding -e (for silent-e verbs)
    const stems = [lower.slice(0, -3), lower.slice(0, -3) + "e"];
    for (const stem of stems) {
      match = knownNames.find((n) => n.toLowerCase() === stem || flattenName(n) === flattenName(stem));
      if (match) return match;
    }
  }
  return undefined;
}

function findSibling(name: string): SiblingInfo | undefined {
  // Fast path: O(1) lookup for exact, lowercase, or flattened match
  const fast = globalNameIndex.get(name.toLowerCase()) ?? globalNameIndex.get(flattenName(name));
  if (fast) return globalSiblings.find((s) => s.name === fast);
  // Slow path: plural resolution (rare)
  const canonical = resolveRefName(name, globalSiblingNames);
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

/** Find an invariant by walking from current context up through ancestors. Returns the owning context's path. */
function findInvariantInScope(name: string): { content: string; ownerPath: string[] } | null {
  if (!globalSigilRoot || !globalCurrentPath) return null;
  for (let depth = globalCurrentPath.length; depth >= 0; depth--) {
    const path = globalCurrentPath.slice(0, depth);
    const ctx = findContextByPath(path, globalSigilRoot);
    if (!ctx) continue;
    const inv = ctx.invariants.find(
      (s) => s.name === name || s.name === fromDashForm(name)
    );
    if (inv) return { content: inv.content, ownerPath: path };
  }
  return null;
}

/** Find an affordance by walking from current context up through ancestors. Returns the owning context's path. */
function findAffordanceInScope(name: string): { content: string; ownerPath: string[] } | null {
  if (!globalSigilRoot || !globalCurrentPath) return null;
  for (let depth = globalCurrentPath.length; depth >= 0; depth--) {
    const path = globalCurrentPath.slice(0, depth);
    const ctx = findContextByPath(path, globalSigilRoot);
    if (!ctx) continue;
    const aff = findAffordance(ctx, name);
    if (aff) return { content: aff.content, ownerPath: path };
  }
  return null;
}

type RefKind = "contained" | "sibling" | "lib" | "absolute" | "external" | "unresolved";

interface RefResolution {
  kind: RefKind;
  /** Absolute path from root (for absolute refs), or [name] for local refs. */
  path: string[];
  /** Explicit navigation path — present when the ref resolves via lexical scope. */
  absolutePath?: string[];
  summary?: string;
}

/** Resolve a matched ref string like "@Sigil@Shaping@Containment" or "@Experience". */
function resolveChainedRef(matchText: string): RefResolution {
  const segments = matchText.slice(1).split("@");

  if (segments.length === 1) {
    // Check if it matches the root sigil name — treat as absolute path to root
    if (globalSigilRoot && resolveRefName(segments[0], [globalSigilRoot.name])) {
      const summary = extractSummary(globalSigilRoot.domain_language || "");
      return { kind: "absolute", path: [], summary };
    }
    const info = findSibling(segments[0]);
    if (info) return {
      kind: info.kind === "lib" ? "lib" : info.kind === "sibling" ? "sibling" : "contained",
      path: [info.name],
      absolutePath: info.absolutePath,
      summary: info.summary,
    };
    return { kind: "unresolved", path: segments };
  }

  if (!globalSigilRoot) return { kind: "external", path: segments };

  // Multi-segment: try root-anchored path first
  const rootCanonical = resolveRefName(segments[0], [globalSigilRoot.name]);
  if (rootCanonical) {
    const resolved = walkTree(segments.slice(1), globalSigilRoot);
    if (resolved !== null) {
      const ctx = findContextByPath(resolved, globalSigilRoot);
      const summary = ctx ? extractSummary(ctx.domain_language || "") : undefined;
      return { kind: "absolute", path: resolved, absolutePath: resolved, summary };
    }
  }

  // Multi-segment: try Libs-anchored path (e.g. @AttentionLanguage@Sigil → Libs/AttentionLanguage/Sigil)
  if (globalSigilRoot) {
    const libsCtx = globalSigilRoot.children.find((c) => c.name === "Libs");
    if (libsCtx) {
      // First segment must match an ontology name under Libs
      const ontologyCanonical = resolveRefName(segments[0], libsCtx.children.map((c) => c.name));
      if (ontologyCanonical) {
        const ontologyCtx = libsCtx.children.find((c) => c.name === ontologyCanonical)!;
        const resolved = walkTree(segments.slice(1), ontologyCtx);
        if (resolved !== null) {
          const fullPath = ["Libs", ontologyCanonical, ...resolved];
          const ctx = findContextByPath(fullPath, globalSigilRoot);
          const summary = ctx ? extractSummary(ctx.domain_language || "") : undefined;
          return { kind: "lib", path: fullPath, absolutePath: fullPath, summary };
        }
        // Ontology matched but child didn't resolve — unresolved, not a boundary violation
        return { kind: "unresolved", path: segments };
      }
    }
  }

  // Multi-segment refs into another sigil's children are outside scope — sigil boundary.
  const firstInfo = findSibling(segments[0]);
  const boundaryName = firstInfo ? segments[0] : null;
  return { kind: "external", path: segments, summary: boundaryName ? `sigil boundary — cannot reach into @${boundaryName}` : undefined };
}

function buildSiblingHighlighter(_names: string[], siblings: SiblingInfo[], sigilRoot: Context | null, currentCtx: Context | null, path: string[] = []) {
  globalSiblings = siblings;
  globalSiblingNames = siblings.map((s) => s.name);
  globalNameIndex = buildNameIndex(globalSiblingNames);
  globalSigilRoot = sigilRoot;
  globalCurrentContext = currentCtx;
  globalCurrentPath = path;

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
              const matchLine = view.state.doc.lineAt(abs);
              if (isInCodeSpan(matchLine.text, abs - matchLine.from)) continue;
              if (matchText.startsWith("@")) {
                const propIdx = findPropSeparator(matchText);
                if (propIdx === -1) {
                  // Pure sigil ref: apply sigil mark to the whole match
                  const resolution = resolveChainedRef(matchText);
                  const mark =
                    resolution.kind === "contained" ? containedMark :
                    resolution.kind === "sibling" ? siblingMark :
                    resolution.kind === "lib" ? libMark :
                    resolution.kind === "absolute" ? absoluteMark :
                    resolution.kind === "external" ? externalMark :
                    unresolvedMark;
                  builder.add(abs, abs + matchText.length, mark);
                } else {
                  // Property ref: @Sigil#affordance or @Sigil!invariant
                  const propChar = matchText[propIdx];
                  builder.add(abs, abs + matchText.length, propChar === "!" ? invariantMark : affordanceMark);
                }
              } else if (matchText.startsWith("!")) {
                const invariantName = matchText.slice(1);
                const invariantExists = findInvariantInScope(invariantName) !== null;
                builder.add(abs, abs + matchText.length, invariantExists ? invariantMark : unresolvedMark);
              } else {
                // Standalone #affordance
                const affExists = findAffordanceInScope(matchText.slice(1)) !== null;
                builder.add(abs, abs + matchText.length, affExists ? affordanceMark : unresolvedMark);
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
      ".cm-ref-lib": {
        borderBottom: "2px dotted #8b5cf6",
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
        color: "#3d9e8c",
        fontStyle: "italic",
      },
      ".cm-ref-invariant": {
        color: "#e8a040",
        fontStyle: "italic",
      },
      "&.cm-cmd-held .cm-ref-contained, &.cm-cmd-held .cm-ref-sibling, &.cm-cmd-held .cm-ref-lib, &.cm-cmd-held .cm-ref-absolute, &.cm-cmd-held .cm-ref-affordance, &.cm-cmd-held .cm-ref-invariant": {
        cursor: "pointer",
        textDecoration: "underline",
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
      const localPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;
      let match;
      while ((match = localPattern.exec(text)) !== null) {
        if (isInCodeSpan(text, match.index)) continue;
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (pos >= from && pos <= to) {
          const matchText = match[0];
          const propIdx = matchText.startsWith("@") ? findPropSeparator(matchText) : -1;
          const propChar = propIdx !== -1 ? matchText[propIdx] : null;
          const sigilPart = matchText.startsWith("@")
            ? (propIdx === -1 ? matchText : matchText.slice(0, propIdx))
            : null;
          const propertyPart = propIdx !== -1 ? matchText.slice(propIdx + 1) : null;

          let summary = "";

          if (sigilPart) {
            const resolution = resolveChainedRef(sigilPart);
            if (resolution.kind === "unresolved") return null;
            if (resolution.kind === "external") {
              summary = resolution.summary ?? "outside scope";
              // fall through to render tooltip with error summary
            } else {
            summary = resolution.summary ?? (resolution.kind === "contained" || resolution.kind === "sibling" || resolution.kind === "lib"
              ? (globalSiblings.find((s) => s.name === resolution.path[0])?.summary ?? "")
              : "");
            if (propertyPart) {
              // Find the property content in the resolved context.
              // Always use the real Context tree (not SiblingInfo) to access affordances/invariants.
              const ctx = globalSigilRoot
                ? findContextByPath(resolution.absolutePath ?? resolution.path, globalSigilRoot)
                : null;
              if (propChar === "!" && ctx) {
                const disp = ctx.invariants.find(
                  (d) => d.name === propertyPart || d.name === fromDashForm(propertyPart!)
                );
                if (disp) summary = disp.content.split("\n").slice(0, 3).join("\n");
              } else if (ctx) {
                const aff = findAffordance(ctx, propertyPart);
                if (aff) summary = aff.content.split("\n").slice(0, 3).join("\n");
              }
            }
            } // end else (non-external)
          } else if (matchText.startsWith("!")) {
            // standalone !invariant — look up in current context
            if (!globalCurrentContext) return null;
            const dispName = matchText.slice(1);
            const disp = globalCurrentContext.invariants.find(
              (c) => c.name === dispName || c.name === fromDashForm(dispName)
            );
            if (!disp) return null;
            summary = disp.content.split("\n").slice(0, 3).join("\n");
          } else {
            // standalone #affordance — look up in current context
            if (!globalCurrentContext) return null;
            const aff = findAffordance(globalCurrentContext, matchText.slice(1));
            if (!aff) return null;
            summary = aff.content.split("\n").slice(0, 3).join("\n");
          }

          if (!summary) return null;

          return {
            pos: from,
            end: to,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "cm-tooltip-sibling";
              const summaryEl = document.createElement("div");
              summaryEl.className = "cm-tooltip-sibling-summary";
              summaryEl.textContent = summary;
              dom.appendChild(summaryEl);
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
      const statusMatch = context.matchBefore(/status:\s*\S*/);
      if (statusMatch) {
        const colonOffset = curLine.text.indexOf(":");
        const afterColon = curLine.text.slice(colonOffset + 1).match(/^\s*/);
        const valueStart = curLine.from + colonOffset + 1 + (afterColon?.[0].length ?? 0);
        return {
          from: valueStart,
          options: getKnownStatuses().map((s) => ({ label: s, type: "keyword" as const })),
          filter: true,
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

  // Precompute ancestor properties for affordance/invariant completion
  const ancestorProps = collectAncestorProperties(globalSigilRoot, globalCurrentPath);

  // Case 0: standalone #partial — offer affordances from current context and ancestors
  const standaloneHash = context.matchBefore(context.explicit ? /#(?:[a-zA-Z_][\w-]*)?/ : /#[a-zA-Z_][\w-]*/);
  if (standaloneHash) {
    const lineText = context.state.doc.lineAt(standaloneHash.from).text;
    const colOfHash = standaloneHash.from - context.state.doc.lineAt(standaloneHash.from).from;
    const charBefore = colOfHash > 0 ? lineText[colOfHash - 1] : "";
    const isAfterSigil = /[\w-]/.test(charBefore);
    if (!isAfterSigil && ancestorProps.affordances.length > 0) {
      return {
        from: standaloneHash.from + 1,
        options: ancestorProps.affordances.map((a) => {
          const dash = toDashForm(a.name);
          return {
            label: dash,
            displayLabel: `#${dash}`,
            detail: `${a.source !== globalCurrentContext?.name ? `[${a.source}] ` : ""}${a.content.split("\n")[0]?.slice(0, 50) || ""}`,
            type: "property" as const,
          };
        }),
        filter: true,
      };
    }
  }

  // Case 0b: standalone !partial — offer invariants from current context and ancestors
  const standaloneBang = context.matchBefore(context.explicit ? /!(?:[a-zA-Z_][\w-]*)?/ : /![a-zA-Z_][\w-]*/);
  if (standaloneBang) {
    const lineText = context.state.doc.lineAt(standaloneBang.from).text;
    const colOfBang = standaloneBang.from - context.state.doc.lineAt(standaloneBang.from).from;
    const charBefore = colOfBang > 0 ? lineText[colOfBang - 1] : "";
    const isAfterWord = /[\w-]/.test(charBefore);
    if (!isAfterWord && ancestorProps.invariants.length > 0) {
      return {
        from: standaloneBang.from + 1,
        options: ancestorProps.invariants.map((d) => {
          const dash = toDashForm(d.name);
          return {
            label: dash,
            displayLabel: `!${dash}`,
            detail: `${d.source !== globalCurrentContext?.name ? `[${d.source}] ` : ""}${d.content.split("\n")[0]?.slice(0, 50) || ""}`,
            type: "property" as const,
          };
        }),
        filter: true,
      };
    }
  }

  // Case 1: @Sigil#partial or @Sigil!partial — offer affordance or invariant names
  const beforeProperty = context.matchBefore(/@(?:[a-zA-Z_][\w-]*@)*[a-zA-Z_][\w-]*[#!](?:[a-zA-Z_][\w-]*)?/);
  if (beforeProperty) {
    const text = beforeProperty.text;
    const sepIdx = findPropSeparator(text);
    if (sepIdx !== -1) {
      const sepChar = text[sepIdx];
      const sigilRef = text.slice(0, sepIdx);
      const ctx = resolveRefToContext(sigilRef);
      if (ctx) {
        const propFrom = beforeProperty.from + sepIdx + 1;
        if (sepChar === "#" && ctx.affordances.length > 0) {
          return {
            from: propFrom,
            options: ctx.affordances.map((a) => {
              const dash = toDashForm(a.name);
              return {
                label: dash,
                displayLabel: `${sigilRef}#${dash}`,
                detail: a.content.split("\n")[0]?.slice(0, 50) || "",
                type: "property" as const,
              };
            }),
            filter: true,
          };
        }
        if (sepChar === "!" && ctx.invariants.length > 0) {
          return {
            from: propFrom,
            options: ctx.invariants.map((d) => {
              const dash = toDashForm(d.name);
              return {
                label: dash,
                displayLabel: `${sigilRef}!${dash}`,
                detail: d.content.split("\n")[0]?.slice(0, 50) || "",
                type: "property" as const,
              };
            }),
            filter: true,
          };
        }
      }
      return null;
    }
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
        label: s.kind === "lib" && s.libPrefix ? `@${s.libPrefix}@${s.name}` : `@${s.name}`,
        detail: `${s.kind === "sibling" ? "[neighbor] " : s.kind === "lib" ? "[lib] " : ""}${s.summary.split("\n")[0]?.slice(0, 50) || ""}`,
        type: s.kind === "sibling" ? "property" as const : s.kind === "lib" ? "enum" as const : "variable" as const,
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

  // Also offer affordances and invariants of the resolved context
  const sigilRefStr = "@" + resolvedParts.join("@");
  for (const aff of ctx.affordances) {
    options.push({
      label: `${sigilRefStr}#${toDashForm(aff.name)}`,
      detail: aff.content.split("\n")[0]?.slice(0, 50) || "",
      type: "property",
    });
  }
  for (const disp of ctx.invariants) {
    options.push({
      label: `${sigilRefStr}!${toDashForm(disp.name)}`,
      detail: disp.content.split("\n")[0]?.slice(0, 50) || "",
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

/** Find a standalone #affordance or !invariant at the cursor, with existence flag. */
function findPropertyRefAtCursor(view: EditorView): { kind: "affordance" | "invariant"; name: string; exists: boolean } | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const pattern = /#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;
  let match;
  while ((match = pattern.exec(line.text)) !== null) {
    if (isInCodeSpan(line.text, match.index)) continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      const text = match[0];
      if (text.startsWith("!")) {
        const name = text.slice(1);
        const exists = !!globalCurrentContext?.invariants.find(
          (s) => s.name === name || s.name === fromDashForm(name)
        );
        return { kind: "invariant", name, exists };
      } else {
        const name = text.slice(1);
        const exists = !!findAffordance(globalCurrentContext ?? undefined, name);
        return { kind: "affordance", name, exists };
      }
    }
  }
  return null;
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
        if (!symbolName || !globalSigilRoot) return false;
        const hits = findAllReferences(globalSigilRoot, symbolName, []);
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
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ codeLanguages: languages }),
        themeCompartment.of(getThemeExtension()),
        siblingCompartment.of(buildSiblingHighlighter(siblingNames, siblings, sigilRoot ?? null, currentContext ?? null, currentPath)),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        buildFrontMatterPlugin(),
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
                  const result = findInvariantInScope(matchText.slice(1));
                  if (result && onNavigateAbsPathRef.current) {
                    event.preventDefault();
                    onNavigateAbsPathRef.current(result.ownerPath);
                    return true;
                  }
                } else if (matchText.startsWith("#")) {
                  // #affordance — navigate to the owning sigil
                  const result = findAffordanceInScope(matchText.slice(1));
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
  // Sync external content changes (e.g. navigation to different sigil).
  // Skip echoes of our own edits — the debounced dispatch sends back content
  // we already have, so replacing would jump the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();

    if (currentDoc === content) {
      localEditRef.current = false;
      lastLocalContentRef.current = null;
      return;
    }

    // If we have local edits, check if this is an echo vs navigation.
    // Echo: the content prop is a stale version of what the editor already has
    //   (debounced dispatch catching up). The editor is ahead — skip.
    // Navigation: content is from a completely different sigil — must replace.
    // Heuristic: if the first 50 chars match, it's an echo. Different sigils
    // have different openings (different frontmatter, headings, etc).
    if (localEditRef.current) {
      const prefix = Math.min(50, content.length, currentDoc.length);
      if (content.slice(0, prefix) === currentDoc.slice(0, prefix)) {
        return;
      }
    }

    // Navigation to a different sigil. Replace content and clear undo history.
    localEditRef.current = false;
    lastLocalContentRef.current = null;
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: content },
      annotations: [Transaction.addToHistory.of(false)],
    });
  }, [content]);

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
