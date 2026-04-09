import { findContext, makeSummary } from "sigil-core";
import type { Sigil } from "sigil-core";
import type { SigilFolder } from "../../tauri";
import type { SiblingInfo } from "./MarkdownEditor";

/** Build the full lexical scope for the current path: children -> ancestry levels -> root.
 *  pathPrefix is prepended to all absolutePath values (e.g., ["Imported Ontologies"] for lib navigation).
 */
export function buildLexicalScope(
  root: SigilFolder,
  currentPath: string[],
  pathPrefix: string[] = [],
): SiblingInfo[] {
  const refs: SiblingInfo[] = [];
  const seen = new Set<string>();
  const currentFolder = findContext(root as Sigil, currentPath) as SigilFolder;
  if (!currentFolder) return refs;

  const add = (name: string, sigil: Sigil, kind: "contained" | "sibling", absolutePath: string[]) => {
    if (!seen.has(name)) {
      seen.add(name);
      refs.push({ name, summary: makeSummary(sigil), kind, absolutePath: [...pathPrefix, ...absolutePath] });
    }
  };

  // Innermost: children of current sigil
  for (const c of currentFolder.children) {
    add(c.name, c, "contained", [...currentPath, c.name]);
  }

  // Walk up the ancestry chain
  for (let depth = currentPath.length; depth > 0; depth--) {
    const levelPath = currentPath.slice(0, depth);
    const levelSigil = findContext(root as Sigil, levelPath);
    const parentPath = levelPath.slice(0, -1);
    const parentSigil = findContext(root as Sigil, parentPath);
    if (!levelSigil || !parentSigil) break;

    add(levelSigil.name, levelSigil, "sibling", levelPath);

    for (const c of parentSigil.children) {
      if (c.name !== levelSigil.name) {
        add(c.name, c, "sibling", [...parentPath, c.name]);
      }
    }
  }

  // Root itself
  add(root.name, root, "sibling", []);

  return refs;
}

/** Collect all sigils in the tree whose name is globally unique — not already in `seen`. */
export function collectGloballyUniqueRefs(
  root: SigilFolder,
  seen: Set<string>,
): SiblingInfo[] {
  // Count occurrences of each name
  const counts = new Map<string, { sigil: SigilFolder; path: string[] }[]>();
  function walk(node: SigilFolder, path: string[]) {
    for (const child of node.children) {
      const childPath = [...path, child.name];
      const list = counts.get(child.name) ?? [];
      list.push({ sigil: child, path: childPath });
      counts.set(child.name, list);
      walk(child, childPath);
    }
  }
  walk(root, []);

  const refs: SiblingInfo[] = [];
  for (const [name, entries] of counts) {
    if (seen.has(name)) continue;
    if (entries.length === 1) {
      seen.add(name);
      const { sigil, path } = entries[0];
      refs.push({ name, summary: makeSummary(sigil), kind: "sibling", absolutePath: path });
    } else {
      // Ambiguous: offer path-qualified completions using parent@name
      for (const { sigil, path } of entries) {
        const parent = path.length >= 2 ? path[path.length - 2] : root.name;
        const qualifiedName = `${parent}@${name}`;
        if (!seen.has(qualifiedName)) {
          seen.add(qualifiedName);
          refs.push({ name: qualifiedName, summary: makeSummary(sigil), kind: "sibling", absolutePath: path });
        }
      }
    }
  }
  return refs;
}

/** Flatten all children of a lib ontology into refs with proper absolutePath. */
export function flattenOntologyRefs(
  ontology: SigilFolder,
  basePath: string[],
  seen: Set<string>,
  libPrefix: string,
): SiblingInfo[] {
  const refs: SiblingInfo[] = [];
  for (const child of ontology.children) {
    const childPath = [...basePath, child.name];
    if (!seen.has(child.name)) {
      seen.add(child.name);
      refs.push({ name: child.name, summary: makeSummary(child), kind: "lib", absolutePath: childPath, libPrefix });
    }
    refs.push(...flattenOntologyRefs(child, childPath, seen, libPrefix));
  }
  return refs;
}
