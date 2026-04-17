import { useMemo } from "react";
import type { Sigil } from "sigil-core";
import {
  findAffordanceInScope,
  findInvariantInScope,
  resolve,
  allRefsPattern,
  isInCodeSpan,
} from "sigil-core";

export interface RefError {
  /** Path segments from root (e.g. ["Idea", "DesignPartner", "BicameralMind"]) */
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

function checkContent(
  root: Sigil,
  currentPath: string[],
  content: string,
  file: string,
  importedOntologies?: Sigil | null,
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

      if (parsed.segments.length > 0) {
        const sigilRef = "@" + parsed.segments.join("@");
        const resolved = resolve(root, currentPath, sigilRef, importedOntologies);
        if (!resolved) {
          errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved sigil" });
          continue;
        }
        if (parsed.property) {
          if (parsed.property.prefix === "#") {
            if (!findAffordanceInScope(root, resolved.path, parsed.property.name, importedOntologies)) {
              errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved affordance" });
            }
          } else {
            if (!findInvariantInScope(root, resolved.path, parsed.property.name, importedOntologies)) {
              errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved invariant" });
            }
          }
        }
      } else if (parsed.property) {
        if (parsed.property.prefix === "#") {
          if (!findAffordanceInScope(root, currentPath, parsed.property.name, importedOntologies)) {
            errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved affordance" });
          }
        } else {
          if (!findInvariantInScope(root, currentPath, parsed.property.name, importedOntologies)) {
            errors.push({ path: currentPath, file, line: i + 1, ref: token, reason: "unresolved invariant" });
          }
        }
      }
    }
  }

  return { errors, refCount };
}

/** Check references in a subtree. Resolution uses the full tree; walking starts at the subtree. */
export function compileCheck(root: Sigil, startPath: string[] = []): CompileResult {
  const allErrors: RefError[] = [];
  let totalRefs = 0;
  const filesWithErrorPaths = new Set<string>();
  const importedOntologies = root.children.find((c) => c.isImported) ?? null;

  function check(path: string[], content: string, file: string) {
    const { errors, refCount } = checkContent(root, path, content, file, importedOntologies);
    totalRefs += refCount;
    if (errors.length > 0) {
      allErrors.push(...errors);
      filesWithErrorPaths.add(path.join("/") + "/" + file);
    }
  }

  function walk(sigil: Sigil, path: string[]) {
    if (sigil.language) check(path, sigil.language, "language.md");
    for (const aff of sigil.affordances) check(path, aff.content, `affordance-${aff.name}.md`);
    for (const inv of sigil.invariants) check(path, inv.content, `invariant-${inv.name}.md`);
    for (const child of sigil.children) {
      if (child.isImported) continue;
      walk(child, [...path, child.name]);
    }
  }

  // Walk from the selected subtree, not from root
  let startNode: Sigil = root;
  for (const seg of startPath) {
    const child = startNode.children.find((c) => c.name === seg);
    if (!child) break;
    startNode = child;
  }
  walk(startNode, startPath);

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
export function useCompileCheck(root: Sigil | null, importedOntologies?: Sigil | null, currentPath: string[] = []): CompileResult {
  return useMemo(() => {
    if (!root) return { errors: [], totalRefs: 0, filesWithErrors: 0 };
    // Mount imported ontologies as a child so references to library sigils resolve.
    // Keep the original name ("Imported Ontologies") so currentPath navigation works
    // when the user is browsed into the imported tree.
    let checkRoot = root;
    if (importedOntologies) {
      const libs: Sigil = {
        ...importedOntologies,
        isImported: true,
      };
      checkRoot = { ...root, children: [...root.children, libs] };
    }
    return compileCheck(checkRoot, currentPath);
  }, [root, importedOntologies, currentPath]);
}
