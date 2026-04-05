/**
 * Shared CodeMirror extensions for sigil reference highlighting, autocomplete,
 * and hover tooltips. Used by both MarkdownEditor and SigilPropertyEditor.
 */
import { EditorState, RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import {
  EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate,
  hoverTooltip, WidgetType, keymap,
} from "@codemirror/view";
import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { SigilFolder } from "../../tauri";
import {
  resolveRefName, findAffordance, findInvariantInScope, findAffordanceInScope,
  flattenName, fromDashForm, buildNameIndex,
} from "sigil-core";

export interface SiblingInfo {
  name: string;
  summary: string;
  kind?: "contained" | "sibling" | "lib";
  absolutePath?: string[];
  libPrefix?: string;
}

// ── Editor context (set by buildSiblingHighlighter, read by completion/decoration) ──
//
// Single mutable object holding the sigil tree context for CodeMirror extensions.
// Mutation happens ONLY in buildSiblingHighlighter() and setGlobalImportedOntologies().
// Long-term: migrate to a CodeMirror StateField so each editor instance owns its context.

export interface SigilEditorContext {
  siblings: SiblingInfo[];
  siblingNames: string[];
  nameIndex: Map<string, string>;
  sigilRoot: SigilFolder | null;
  importedOntologies: SigilFolder | null;
  currentContext: SigilFolder | null;
  currentPath: string[];
}

const editorCtx: SigilEditorContext = {
  siblings: [],
  siblingNames: [],
  nameIndex: new Map(),
  sigilRoot: null,
  importedOntologies: null,
  currentContext: null,
  currentPath: [],
};

/** Read the current editor context. Do not mutate — use buildSiblingHighlighter. */
export function getEditorContext(): Readonly<SigilEditorContext> { return editorCtx; }

// Convenience accessors (match existing call sites, thin wrappers)
export function getGlobalSiblings() { return editorCtx.siblings; }
export function getGlobalSigilRoot() { return editorCtx.sigilRoot; }
export function setGlobalImportedOntologies(ctx: SigilFolder | null) { editorCtx.importedOntologies = ctx; }
export function getGlobalCurrentContext() { return editorCtx.currentContext; }
export function getGlobalCurrentPath() { return editorCtx.currentPath; }

// ── Decoration marks ──

const containedMark = Decoration.mark({ class: "cm-ref-contained" });
const siblingMark = Decoration.mark({ class: "cm-ref-sibling" });
const libMark = Decoration.mark({ class: "cm-ref-lib" });
const unresolvedMark = Decoration.mark({ class: "cm-ref-unresolved" });
const absoluteMark = Decoration.mark({ class: "cm-ref-absolute" });
const externalMark = Decoration.mark({ class: "cm-ref-external" });
const affordanceMark = Decoration.mark({ class: "cm-ref-affordance" });
const invariantMark = Decoration.mark({ class: "cm-ref-invariant" });
const todoMark = Decoration.mark({ class: "cm-todo" });

// ── Patterns ──

export const allRefsPattern = /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

// ── Utility functions ──

export function isInCodeSpan(lineText: string, matchIndex: number): boolean {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (lineText[i] === "`") count++;
  }
  return count % 2 === 1;
}

export function toDashForm(name: string): string {
  return name.replace(/\s+/g, "-");
}

export function findPropSeparator(refText: string): number {
  for (let i = 1; i < refText.length; i++) {
    if (refText[i] === "@") continue;
    if (refText[i] === "#" || refText[i] === "!") return i;
    while (i < refText.length && /[\w-]/.test(refText[i])) i++;
    if (i < refText.length && refText[i] === "@") continue;
    if (i < refText.length && (refText[i] === "#" || refText[i] === "!")) return i;
    break;
  }
  return -1;
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

export function findSibling(name: string): SiblingInfo | undefined {
  const fast = editorCtx.nameIndex.get(name.toLowerCase()) ?? editorCtx.nameIndex.get(flattenName(name));
  if (fast) return editorCtx.siblings.find((s) => s.name === fast);
  const canonical = resolveRefName(name, editorCtx.siblingNames);
  return canonical ? editorCtx.siblings.find((s) => s.name === canonical) : undefined;
}

export function walkTree(segments: string[], ctx: SigilFolder): string[] | null {
  if (segments.length === 0) return [];
  const canonical = resolveRefName(segments[0], ctx.children.map((c) => c.name));
  if (!canonical) return null;
  const child = ctx.children.find((c) => c.name === canonical)!;
  const rest = walkTree(segments.slice(1), child);
  if (rest === null) return null;
  return [canonical, ...rest];
}

export function findContextByPath(path: string[], root: SigilFolder): SigilFolder | null {
  let ctx: SigilFolder = root;
  for (const seg of path) {
    const child = ctx.children.find((c) => c.name === seg);
    if (!child) return null;
    ctx = child;
  }
  return ctx;
}

export function findInvariantInScopeLocal(name: string): { content: string; ownerPath: string[] } | null {
  if (!editorCtx.sigilRoot || !editorCtx.currentPath) return null;
  return findInvariantInScope(editorCtx.sigilRoot, editorCtx.currentPath, name);
}

export function findAffordanceInScopeLocal(name: string): { content: string; ownerPath: string[] } | null {
  if (!editorCtx.sigilRoot || !editorCtx.currentPath) return null;
  return findAffordanceInScope(editorCtx.sigilRoot, editorCtx.currentPath, name);
}

type RefKind = "contained" | "sibling" | "lib" | "absolute" | "external" | "unresolved";

interface RefResolution {
  kind: RefKind;
  path: string[];
  absolutePath?: string[];
  summary?: string;
}

export function resolveChainedRef(matchText: string): RefResolution {
  const segments = matchText.slice(1).split("@");

  if (segments.length === 1) {
    if (editorCtx.sigilRoot && resolveRefName(segments[0], [editorCtx.sigilRoot.name])) {
      const summary = extractSummary(editorCtx.sigilRoot.language || "");
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

  if (!editorCtx.sigilRoot) return { kind: "external", path: segments };

  const rootCanonical = resolveRefName(segments[0], [editorCtx.sigilRoot.name]);
  if (rootCanonical) {
    const resolved = walkTree(segments.slice(1), editorCtx.sigilRoot);
    if (resolved !== null) {
      const ctx = findContextByPath(resolved, editorCtx.sigilRoot);
      const summary = ctx ? extractSummary(ctx.language || "") : undefined;
      return { kind: "absolute", path: resolved, absolutePath: resolved, summary };
    }
  }

  if (editorCtx.importedOntologies) {
    const ontologyCanonical = resolveRefName(segments[0], editorCtx.importedOntologies.children.map((c) => c.name));
    if (ontologyCanonical) {
      const ontologyCtx = editorCtx.importedOntologies.children.find((c) => c.name === ontologyCanonical)!;
      const resolved = walkTree(segments.slice(1), ontologyCtx);
      if (resolved !== null) {
        const fullPath = [editorCtx.importedOntologies.name, ontologyCanonical, ...resolved];
        const summary = extractSummary(ontologyCtx.language || "");
        return { kind: "lib", path: fullPath, absolutePath: fullPath, summary };
      }
      return { kind: "unresolved", path: segments };
    }
  }

  const firstInfo = findSibling(segments[0]);
  const boundaryName = firstInfo ? segments[0] : null;
  return { kind: "external", path: segments, summary: boundaryName ? `sigil boundary — cannot reach into @${boundaryName}` : undefined };
}

function findContextByName(name: string, root: SigilFolder): SigilFolder | null {
  if (resolveRefName(name, [root.name])) return root;
  for (const child of root.children) {
    const found = findContextByName(name, child);
    if (found) return found;
  }
  return null;
}

export function resolveRefToContext(sigilRef: string): SigilFolder | null {
  if (!editorCtx.sigilRoot) return null;
  const resolution = resolveChainedRef(sigilRef);
  if (resolution.kind === "absolute") return findContextByPath(resolution.path, editorCtx.sigilRoot);
  if (resolution.kind === "contained" || resolution.kind === "sibling") {
    return findContextByName(resolution.path[0], editorCtx.sigilRoot);
  }
  return null;
}

export function collectAncestorProperties(root: SigilFolder | null, path: string[]) {
  if (!root) return { affordances: [] as { name: string; content: string; source: string }[], invariants: [] as { name: string; content: string; source: string }[] };
  const affordances: { name: string; content: string; source: string }[] = [];
  const invariants: { name: string; content: string; source: string }[] = [];
  const seenAffs = new Set<string>();
  const seenInvs = new Set<string>();

  const addFrom = (ctx: SigilFolder) => {
    for (const a of ctx.affordances) {
      if (!seenAffs.has(a.name)) {
        seenAffs.add(a.name);
        affordances.push({ name: a.name, content: a.content, source: ctx.name });
      }
    }
    for (const d of ctx.invariants) {
      if (!seenInvs.has(d.name)) {
        seenInvs.add(d.name);
        invariants.push({ name: d.name, content: d.content, source: ctx.name });
      }
    }
  };

  // Walk from root down to current context, at each level also including siblings (one level deep)
  let ctx = root;
  addFrom(ctx);
  // Root's children (siblings of the top-level path segment)
  for (const child of ctx.children) addFrom(child);

  for (const seg of path) {
    const next = ctx.children.find((c) => c.name === seg);
    if (!next) break;
    ctx = next;
    addFrom(ctx);
    // This level's children (includes siblings of next path segment, and children of current)
    for (const child of ctx.children) addFrom(child);
  }
  return { affordances, invariants };
}

// ── Autocomplete ──

export function siblingCompletion(context: CompletionContext) {
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

  return siblingCompletionBody(context);
}

/** Autocomplete for references only (no front-matter handling). Used by property panels. */
export function refCompletion(context: CompletionContext) {
  return siblingCompletionBody(context);
}

function siblingCompletionBody(context: CompletionContext) {
  const ancestorProps = collectAncestorProperties(editorCtx.sigilRoot, editorCtx.currentPath);

  // Case 0: standalone #partial — offer affordances
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
            detail: `${a.source !== editorCtx.currentContext?.name ? `[${a.source}] ` : ""}${a.content.split("\n")[0]?.slice(0, 50) || ""}`,
            type: "property" as const,
          };
        }),
        filter: true,
      };
    }
  }

  // Case 0b: standalone !partial — offer invariants
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
            detail: `${d.source !== editorCtx.currentContext?.name ? `[${d.source}] ` : ""}${d.content.split("\n")[0]?.slice(0, 50) || ""}`,
            type: "property" as const,
          };
        }),
        filter: true,
      };
    }
  }

  // Case 1: @Sigil#partial or @Sigil!partial
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

  // Case 2: @A@B@C chains or bare @
  const before = context.matchBefore(/@(?:[a-zA-Z_][\w-]*@)*(?:[a-zA-Z_][\w-]*)?/);
  if (!before) return null;

  const typed = before.text;
  const segments = typed.slice(1).split("@");

  if (segments.length <= 1) {
    if (editorCtx.siblings.length === 0) return null;
    return {
      from: before.from,
      options: editorCtx.siblings.map((s) => ({
        label: s.kind === "lib" && s.libPrefix ? `@${s.libPrefix}@${s.name}` : `@${s.name}`,
        detail: `${s.kind === "sibling" ? "[neighbor] " : s.kind === "lib" ? "[lib] " : ""}${s.summary.split("\n")[0]?.slice(0, 50) || ""}`,
        type: s.kind === "sibling" ? "property" as const : s.kind === "lib" ? "enum" as const : "variable" as const,
      })),
      filter: true,
    };
  }

  if (!editorCtx.sigilRoot) return null;
  const prefix = segments.slice(0, -1);

  const rootCanonical = resolveRefName(prefix[0], [editorCtx.sigilRoot.name]);
  if (!rootCanonical) return null;

  let ctx: SigilFolder = editorCtx.sigilRoot;
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

  for (const child of ctx.children) {
    options.push({
      label: `${prefixStr}${child.name}`,
      detail: (child.language || "").split("\n").filter((l) => l.trim())[0]?.slice(0, 50) || "",
      type: "variable",
    });
  }

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

// ── Front matter helpers (used by siblingCompletion) ──

const DEFAULT_STATUS = "idea";

function extractStatus(domainLanguage: string): string | null {
  if (!domainLanguage.startsWith("---")) return null;
  const end = domainLanguage.indexOf("\n---", 3);
  if (end === -1) return null;
  const match = domainLanguage.slice(3, end).match(/^status:\s*(\S+)/m);
  return match ? match[1] : null;
}

function collectStatusesExcluding(ctx: SigilFolder, excludePath: string): string[] {
  if (ctx.path === excludePath) return ctx.children.flatMap((c) => collectStatusesExcluding(c, excludePath));
  const status = extractStatus(ctx.language || "");
  return [
    ...(status ? [status] : []),
    ...ctx.children.flatMap((c) => collectStatusesExcluding(c, excludePath)),
  ];
}

function getKnownStatuses(): string[] {
  const excludePath = editorCtx.currentContext?.path ?? "";
  const found = editorCtx.sigilRoot
    ? collectStatusesExcluding(editorCtx.sigilRoot, excludePath)
    : [];
  return [DEFAULT_STATUS, ...found].filter((s, i, arr) => arr.indexOf(s) === i);
}

export function getFrontMatterEnd(doc: { lines: number; line: (n: number) => { text: string; from: number; to: number } }): number {
  if (doc.lines < 2 || doc.line(1).text !== "---") return -1;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text === "---") return i;
  }
  return -1;
}

// ── Collapsible frontmatter ──

const toggleFrontmatter = StateEffect.define<boolean>();

const frontMatterLineMark = Decoration.line({ class: "cm-front-matter" });

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

export function buildCollapsibleFrontmatter() {
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
        event.preventDefault();
        view.dispatch({ effects: toggleFrontmatter.of(false) });
        return true;
      }

      if (!isCollapsed && pos > fmEnd) {
        view.dispatch({ effects: toggleFrontmatter.of(true) });
        return false;
      }

      return false;
    },
  });

  return [collapsed, decorations, clickHandler];
}

// ── Ref cursor helpers (for Alt+Enter create, rename) ──

export function findRefAtCursor(view: EditorView): { name: string; from: number; known: boolean } | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const refPattern = /@([a-zA-Z_][\w-]*)/g;
  let match;
  while ((match = refPattern.exec(line.text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      const raw = match[1];
      const canonical = resolveRefName(raw, editorCtx.siblings.map((s) => s.name));
      const known = canonical !== undefined;
      return { name: canonical ?? raw, from, known };
    }
  }
  return null;
}

export function findPropertyRefAtCursor(view: EditorView): { kind: "affordance" | "invariant"; name: string; exists: boolean; targetContext?: SigilFolder } | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);

  // First check for qualified refs like @Sigil#affordance or @Sigil!invariant
  allRefsPattern.lastIndex = 0;
  let qMatch;
  while ((qMatch = allRefsPattern.exec(line.text)) !== null) {
    if (!qMatch[0].startsWith("@")) continue;
    const propIdx = findPropSeparator(qMatch[0]);
    if (propIdx === -1) continue;
    if (isInCodeSpan(line.text, qMatch.index)) continue;
    const from = line.from + qMatch.index;
    const to = from + qMatch[0].length;
    if (pos >= from && pos <= to) {
      const propChar = qMatch[0][propIdx];
      const propName = qMatch[0].slice(propIdx + 1);
      const sigilRef = qMatch[0].slice(0, propIdx);
      const targetCtx = resolveRefToContext(sigilRef);
      if (propChar === "!") {
        const exists = !!targetCtx?.invariants.find((s) => s.name === propName || s.name === fromDashForm(propName));
        return { kind: "invariant", name: propName, exists, targetContext: targetCtx ?? undefined };
      } else {
        const exists = !!findAffordance(targetCtx ?? undefined, propName);
        return { kind: "affordance", name: propName, exists, targetContext: targetCtx ?? undefined };
      }
    }
  }

  // Then check for bare #affordance or !invariant
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
        const exists = !!editorCtx.currentContext?.invariants.find(
          (s) => s.name === name || s.name === fromDashForm(name)
        );
        return { kind: "invariant", name, exists };
      } else {
        const name = text.slice(1);
        const exists = !!findAffordance(editorCtx.currentContext ?? undefined, name);
        return { kind: "affordance", name, exists };
      }
    }
  }
  return null;
}

// ── Highlighter + hover tooltip builder ──

export function buildSiblingHighlighter(
  _names: string[],
  siblings: SiblingInfo[],
  sigilRoot: SigilFolder | null,
  currentCtx: SigilFolder | null,
  path: string[] = [],
) {
  editorCtx.siblings = siblings;
  editorCtx.siblingNames = siblings.map((s) => s.name);
  editorCtx.nameIndex = buildNameIndex(editorCtx.siblingNames);
  editorCtx.sigilRoot = sigilRoot;
  editorCtx.currentContext = currentCtx;
  editorCtx.currentPath = path;

  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(update: ViewUpdate) {
          this.decorations = this.build(update.view);
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
                  const propChar = matchText[propIdx];
                  const propName = matchText.slice(propIdx + 1);
                  const sigilRef = matchText.slice(0, propIdx);
                  const targetCtx = resolveRefToContext(sigilRef);
                  let propExists = false;
                  if (targetCtx) {
                    if (propChar === "#") {
                      propExists = !!findAffordance(targetCtx, propName);
                    } else {
                      propExists = targetCtx.invariants.some((inv) => inv.name === propName || inv.name === fromDashForm(propName));
                    }
                  }
                  const mark = propExists ? (propChar === "!" ? invariantMark : affordanceMark) : unresolvedMark;
                  builder.add(abs, abs + matchText.length, mark);
                }
              } else if (matchText.startsWith("!")) {
                const invariantName = matchText.slice(1);
                const invariantExists = findInvariantInScopeLocal(invariantName) !== null;
                builder.add(abs, abs + matchText.length, invariantExists ? invariantMark : unresolvedMark);
              } else {
                const affExists = findAffordanceInScopeLocal(matchText.slice(1)) !== null;
                builder.add(abs, abs + matchText.length, affExists ? affordanceMark : unresolvedMark);
              }
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    ),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.buildTodos(view); }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged)
            this.decorations = this.buildTodos(update.view);
        }
        buildTodos(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const pattern = /\bTODO\b/gi;
          for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            let match;
            pattern.lastIndex = 0;
            while ((match = pattern.exec(text)) !== null) {
              builder.add(from + match.index, from + match.index + match[0].length, todoMark);
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    ),
    refTheme,
    hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const localPattern = new RegExp(allRefsPattern.source, "g");
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
            if (resolution.kind === "unresolved") {
              summary = `unresolved: ${sigilPart}`;
            } else if (resolution.kind === "external") {
              summary = resolution.summary ?? "outside scope";
            } else {
              summary = resolution.summary ?? (resolution.kind === "contained" || resolution.kind === "sibling" || resolution.kind === "lib"
                ? (editorCtx.siblings.find((s) => s.name === resolution.path[0])?.summary ?? "")
                : "");
              if (propertyPart) {
                const ctx = editorCtx.sigilRoot
                  ? findContextByPath(resolution.absolutePath ?? resolution.path, editorCtx.sigilRoot)
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
            }
          } else if (matchText.startsWith("!")) {
            const result = findInvariantInScopeLocal(matchText.slice(1));
            if (result) {
              summary = result.content.split("\n").slice(0, 3).join("\n");
            } else {
              summary = `unresolved invariant: ${matchText}`;
            }
          } else {
            const result = findAffordanceInScopeLocal(matchText.slice(1));
            if (result) {
              summary = result.content.split("\n").slice(0, 3).join("\n");
            } else {
              summary = `unresolved affordance: ${matchText}`;
            }
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

// ── Shared theme for reference styles ──

export const refTheme = EditorView.theme({
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
  ".cm-todo": {
    color: "var(--danger)",
    fontWeight: "bold",
  },
  "&.cm-cmd-held .cm-ref-contained, &.cm-cmd-held .cm-ref-sibling, &.cm-cmd-held .cm-ref-lib, &.cm-cmd-held .cm-ref-absolute, &.cm-cmd-held .cm-ref-affordance, &.cm-cmd-held .cm-ref-invariant": {
    cursor: "pointer",
    textDecoration: "underline",
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
});

// ── Shared theme toggle ──

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

export function getThemeExtension(): typeof oneDark | typeof lightTheme {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" ? oneDark : lightTheme;
}

// ── Compact extensions for property panels ──

export interface PropertyEditorCallbacks {
  onCreateAffordance?: (name: string) => void;
  onCreateInvariant?: (name: string) => void;
  onRenameSigil?: (oldName: string, newName: string) => void;
  onRenameProperty?: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onNavigateToSigil?: (name: string) => void;
  onNavigateToAbsPath?: (path: string[]) => void;
  onRenameStart?: (target: { oldName: string; x: number; y: number; kind: "sigil" | "affordance" | "invariant" }) => void;
  onFindReferences?: (hits: { contextName: string; contextPath: string[]; line: string }[], x: number, y: number) => void;
  keybindings?: Record<string, string>;
}

export function buildPropertyExtensions(
  onCreateAffordance?: (name: string) => void,
  onCreateInvariant?: (name: string) => void,
  callbacks?: PropertyEditorCallbacks,
) {
  const cb = callbacks ?? {};
  const kb = cb.keybindings ?? {};

  const extensions: ReturnType<typeof autocompletion>[] = [
    autocompletion({
      override: [refCompletion],
      activateOnTyping: true,
      activateOnTypingDelay: 0,
    }),
  ];

  // Alt+Enter: create affordance/invariant
  if (onCreateAffordance || onCreateInvariant) {
    extensions.push(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.altKey && event.key === "Enter") {
            const prop = findPropertyRefAtCursor(view);
            if (prop && !prop.exists) {
              if (prop.kind === "affordance" && onCreateAffordance) {
                onCreateAffordance(prop.name);
                event.preventDefault();
                return true;
              }
              if (prop.kind === "invariant" && onCreateInvariant) {
                onCreateInvariant(prop.name);
                event.preventDefault();
                return true;
              }
            }
            return false;
          }
          return false;
        },
      }),
    );
  }

  // Rename shortcut
  if (cb.onRenameStart) {
    const onRenameStart = cb.onRenameStart;
    extensions.push(
      keymap.of([{
        key: kb["rename-sigil"] || "Alt-Mod-r",
        run: (view) => {
          const prop = findPropertyRefAtCursor(view);
          if (prop?.exists) {
            const pos = view.state.selection.main.head;
            const coords = view.coordsAtPos(pos);
            const rect = view.dom.getBoundingClientRect();
            if (coords) onRenameStart({ oldName: prop.name, x: coords.left - rect.left, y: coords.bottom - rect.top + 4, kind: prop.kind });
            return true;
          }
          const ref = findRefAtCursor(view);
          if (ref?.known) {
            const coords = view.coordsAtPos(ref.from);
            const rect = view.dom.getBoundingClientRect();
            if (coords) onRenameStart({ oldName: ref.name, x: coords.left - rect.left, y: coords.bottom - rect.top + 4, kind: "sigil" });
            return true;
          }
          return false;
        },
      }]),
    );
  }

  // Find references shortcut
  if (cb.onFindReferences) {
    const onFindReferences = cb.onFindReferences;
    extensions.push(
      keymap.of([{
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
          const root = getGlobalSigilRoot();
          if (!symbolName || !root) return false;
          const hits = findAllReferencesInTree(root, symbolName, []);
          if (hits.length === 0) return false;
          const pos = view.state.selection.main.head;
          const coords = view.coordsAtPos(pos);
          const rect = view.dom.getBoundingClientRect();
          if (coords) onFindReferences(hits, coords.left - rect.left, coords.bottom - rect.top + 4);
          return true;
        },
      }]),
    );
  }

  // Delete line (Cmd+D)
  extensions.push(
    keymap.of([{
      key: kb["delete-line"] || "Mod-d",
      run: (view) => {
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const from = line.from;
        const to = Math.min(line.to + 1, view.state.doc.length);
        view.dispatch({ changes: { from, to } });
        return true;
      },
    }]),
  );

  // Cmd+click navigation
  if (cb.onNavigateToAbsPath || cb.onNavigateToSigil) {
    extensions.push(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.key === "Meta" || event.key === "Control") view.dom.classList.add("cm-cmd-held");
          return false;
        },
        keyup: (event, view) => {
          if (event.key === "Meta" || event.key === "Control") view.dom.classList.remove("cm-cmd-held");
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
          const clickPattern = new RegExp(allRefsPattern.source, "g");
          let match;
          while ((match = clickPattern.exec(line.text)) !== null) {
            const from = line.from + match.index;
            const to = from + match[0].length;
            if (pos >= from && pos <= to) {
              const matchText = match[0];
              if (matchText.startsWith("@")) {
                const propIdx = findPropSeparator(matchText);
                const sigilRef = propIdx === -1 ? matchText : matchText.slice(0, propIdx);
                const resolution = resolveChainedRef(sigilRef);
                if (cb.onNavigateToAbsPath && resolution.absolutePath !== undefined) {
                  event.preventDefault();
                  cb.onNavigateToAbsPath(resolution.absolutePath);
                  return true;
                }
                if (resolution.kind === "absolute" && cb.onNavigateToAbsPath) {
                  event.preventDefault();
                  cb.onNavigateToAbsPath(resolution.path);
                  return true;
                }
                if ((resolution.kind === "contained" || resolution.kind === "sibling") && cb.onNavigateToSigil) {
                  event.preventDefault();
                  cb.onNavigateToSigil(resolution.path[0]);
                  return true;
                }
              } else if (matchText.startsWith("!")) {
                const result = findInvariantInScopeLocal(matchText.slice(1));
                if (result && cb.onNavigateToAbsPath) {
                  event.preventDefault();
                  cb.onNavigateToAbsPath(result.ownerPath);
                  return true;
                }
              } else if (matchText.startsWith("#")) {
                const result = findAffordanceInScopeLocal(matchText.slice(1));
                if (result && cb.onNavigateToAbsPath) {
                  event.preventDefault();
                  cb.onNavigateToAbsPath(result.ownerPath);
                  return true;
                }
              }
            }
          }
          return false;
        },
      }),
    );
  }

  return extensions;
}

/** Find all references to a symbol across the entire sigil tree. */
export function findAllReferencesInTree(ctx: SigilFolder, symbolName: string, path: string[]): { contextName: string; contextPath: string[]; line: string }[] {
  const results: { contextName: string; contextPath: string[]; line: string }[] = [];
  const lines = ctx.language.split("\n");
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
    results.push(...findAllReferencesInTree(child, symbolName, [...path, child.name]));
  }
  return results;
}
