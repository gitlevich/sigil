import { useMemo } from "react";
import type { Sigil } from "sigil-core";
import {
  buildLexicalScope,
  findAffordanceInScope,
  findInvariantInScope,
  resolveRefName,
  findContext,
} from "sigil-core";

export interface RefError {
  /** Path segments from root (e.g. ["Application", "DesignPartner", "BicameralMind"]) */
  path: string[];
  /** Filename where the error occurred */
  file: string;
  line: number;
  ref: string;
  reason: string;
}

export interface CompileResult {
  errors: RefError[];
  totalRefs: number;
  filesWithErrors: number;
}

const allRefsPattern =
  /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

function isInCodeSpan(lineText: string, matchIndex: number): boolean {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (lineText[i] === "`") count++;
  }
  return count % 2 === 1;
}

interface ParsedRef {
  segments: string[];
  property?: { prefix: "#" | "!"; name: string };
}

function parseRef(token: string): ParsedRef | null {
  if (token.startsWith("#")) {
    return { segments: [], property: { prefix: "#", name: token.slice(1) } };
  }
  if (token.startsWith("!")) {
    return { segments: [], property: { prefix: "!", name: token.slice(1) } };
  }
  const withoutAt = token.slice(1);
  let property: ParsedRef["property"];
  let segmentStr = withoutAt;
  const propMatch = withoutAt.match(/([#!])([a-zA-Z_][\w-]*)$/);
  if (propMatch) {
    property = { prefix: propMatch[1] as "#" | "!", name: propMatch[2] };
    segmentStr = withoutAt.slice(0, propMatch.index);
  }
  const segments = segmentStr.split("@").filter(Boolean);
  return { segments, property };
}

function findSigilPathDFS(sigil: Sigil, name: string, prefix: string[]): string[] | null {
  for (const child of sigil.children) {
    const childPath = [...prefix, child.name];
    if (child.name === name) return childPath;
    const found = findSigilPathDFS(child, name, childPath);
    if (found) return found;
  }
  return null;
}

function findSigilPath(root: Sigil, name: string): string[] | null {
  if (root.name === name) return [];
  return findSigilPathDFS(root, name, []);
}

function resolveSegments(root: Sigil, currentPath: string[], segments: string[]): string[] | null {
  if (segments.length === 0) return currentPath;

  const scope = buildLexicalScope(root, currentPath);
  const sigilNames = scope.filter((r) => r.prefix === "@").map((r) => r.name);
  const firstName = segments[0];
  const resolved = resolveRefName(firstName, sigilNames);
  if (!resolved) return null;

  const targetPath = findSigilPath(root, resolved);
  if (!targetPath) return null;

  if (segments.length === 1) return targetPath;

  let ctx = findContext(root, targetPath);
  if (!ctx) return null;
  const resultPath = [...targetPath];
  for (let i = 1; i < segments.length; i++) {
    const childNames = ctx.children.map((c) => c.name);
    const childResolved = resolveRefName(segments[i], childNames);
    if (!childResolved) return null;
    resultPath.push(childResolved);
    const next = ctx.children.find((c) => c.name === childResolved);
    if (!next) return null;
    ctx = next;
  }
  return resultPath;
}

function checkContent(
  root: Sigil,
  currentPath: string[],
  content: string,
  file: string,
): { errors: RefError[]; refCount: number } {
  const lines = content.split("\n");
  const errors: RefError[] = [];
  let refCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    allRefsPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = allRefsPattern.exec(line)) !== null) {
      if (isInCodeSpan(line, m.index)) continue;
      const token = m[0];
      const parsed = parseRef(token);
      if (!parsed) continue;
      refCount++;

      let targetPath = currentPath;
      if (parsed.segments.length > 0) {
        const resolved = resolveSegments(root, currentPath, parsed.segments);
        if (!resolved) {
          errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved sigil" });
          continue;
        }
        targetPath = resolved;
      }

      if (parsed.property) {
        if (parsed.property.prefix === "#") {
          if (!findAffordanceInScope(root, targetPath, parsed.property.name)) {
            errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved affordance" });
          }
        } else {
          if (!findInvariantInScope(root, targetPath, parsed.property.name)) {
            errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved invariant" });
          }
        }
      }
    }
  }

  return { errors, refCount };
}

/** Walk the entire sigil tree and check all references. */
export function compileCheck(root: Sigil): CompileResult {
  const allErrors: RefError[] = [];
  let totalRefs = 0;
  const filesWithErrorPaths = new Set<string>();

  function walk(sigil: Sigil, path: string[]) {
    // Check language.md
    if (sigil.language) {
      const { errors, refCount } = checkContent(root, path, sigil.language, "language.md");
      totalRefs += refCount;
      if (errors.length > 0) {
        allErrors.push(...errors);
        filesWithErrorPaths.add(path.join("/") + "/language.md");
      }
    }

    // Check affordances
    for (const aff of sigil.affordances) {
      const file = `affordance-${aff.name}.md`;
      const { errors, refCount } = checkContent(root, path, aff.content, file);
      totalRefs += refCount;
      if (errors.length > 0) {
        allErrors.push(...errors);
        filesWithErrorPaths.add(path.join("/") + "/" + file);
      }
    }

    // Check invariants
    for (const inv of sigil.invariants) {
      const file = `invariant-${inv.name}.md`;
      const { errors, refCount } = checkContent(root, path, inv.content, file);
      totalRefs += refCount;
      if (errors.length > 0) {
        allErrors.push(...errors);
        filesWithErrorPaths.add(path.join("/") + "/" + file);
      }
    }

    // Recurse children
    for (const child of sigil.children) {
      if (child.isImported) continue;
      walk(child, [...path, child.name]);
    }
  }

  walk(root, []);

  return {
    errors: allErrors,
    totalRefs,
    filesWithErrors: filesWithErrorPaths.size,
  };
}

/**
 * Run compile check against the in-memory sigil tree.
 * Libs/imported ontologies must be passed separately — they are mounted as a
 * child of root (mirroring the CLI script) so references to library sigils resolve.
 * Memoized on tree identity — only re-runs when the spec changes.
 */
export function useCompileCheck(root: Sigil | null, importedOntologies?: Sigil | null): CompileResult {
  return useMemo(() => {
    if (!root) return { errors: [], totalRefs: 0, filesWithErrors: 0 };
    // Mount imported ontologies as "Libs" child, same as the CLI compile-check
    let checkRoot = root;
    if (importedOntologies) {
      const libs: Sigil = {
        ...importedOntologies,
        name: "Libs",
        isImported: true,
      };
      checkRoot = { ...root, children: [...root.children, libs] };
    }
    return compileCheck(checkRoot);
  }, [root, importedOntologies]);
}
