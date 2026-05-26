import { allRefsPattern, fromDashForm, isInCodeSpan, nameMatches, resolve } from "sigil-core";
import type { Sigil } from "sigil-core";
import type { SigilFolder } from "../../tauri";

export interface RefHit {
  contextName: string;
  contextPath: string[];
  line: string;
}

export interface ReferenceTarget {
  name: string;
  fsPath?: string;
}

function sigilRefPart(text: string): string {
  const propIndex = text.search(/[#!]/);
  return propIndex === -1 ? text : text.slice(0, propIndex);
}

function lastSigilSegment(text: string): string {
  const refPart = sigilRefPart(text);
  const parts = refPart.slice(1).split("@");
  return parts[parts.length - 1];
}

function refMatchesTarget(
  text: string,
  target: ReferenceTarget,
  scopeRoot: SigilFolder,
  importedOntologies: SigilFolder | null,
  currentPath: string[],
): boolean {
  if (text.startsWith("@")) {
    if (target.fsPath) {
      const refPart = sigilRefPart(text);
      const resolved = resolve(scopeRoot as Sigil, currentPath, refPart, importedOntologies as Sigil | null);
      return (resolved?.target as SigilFolder | undefined)?.path === target.fsPath;
    }
    return nameMatches(lastSigilSegment(text), target.name);
  }

  const propertyName = fromDashForm(text.slice(1));
  return nameMatches(propertyName, target.name);
}

function findReferencesInScope(
  ctx: SigilFolder,
  path: string[],
  target: ReferenceTarget,
  scopeRoot: SigilFolder,
  importedOntologies: SigilFolder | null,
  pathPrefix: string[],
): RefHit[] {
  const results: RefHit[] = [];
  const lines = ctx.language.split("\n");
  for (const line of lines) {
    let match;
    allRefsPattern.lastIndex = 0;
    while ((match = allRefsPattern.exec(line)) !== null) {
      if (isInCodeSpan(line, match.index)) continue;
      if (refMatchesTarget(match[0], target, scopeRoot, importedOntologies, path)) {
        results.push({ contextName: ctx.name, contextPath: [...pathPrefix, ...path], line: line.trim() });
        break;
      }
    }
  }

  for (const child of ctx.children) {
    results.push(...findReferencesInScope(
      child,
      [...path, child.name],
      target,
      scopeRoot,
      importedOntologies,
      pathPrefix,
    ));
  }

  return results;
}

export function findReferencesInWorkspace(
  root: SigilFolder,
  importedOntologies: SigilFolder | null | undefined,
  target: ReferenceTarget,
): RefHit[] {
  const hits = findReferencesInScope(root, [], target, root, importedOntologies ?? null, []);
  if (importedOntologies) {
    hits.push(...findReferencesInScope(
      importedOntologies,
      [],
      target,
      importedOntologies,
      null,
      ["Imported Ontologies"],
    ));
  }
  return hits;
}

/** Backwards-compatible symbol search used for property-name lookups. */
export function findAllReferencesInTree(
  ctx: SigilFolder,
  symbolName: string,
  path: string[],
): RefHit[] {
  return findReferencesInScope(ctx, path, { name: symbolName }, ctx, null, []);
}
