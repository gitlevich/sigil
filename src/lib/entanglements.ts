/**
 * Extract the @-references of the currently-inhabited sigil and classify
 * each as Neighbor (peer in the main spec tree) or God (imported ontology —
 * shared vocabulary many sigils attend to). Children are excluded because
 * they have their own icon kind on the desktop; ancestors are excluded
 * because the structural parent has its own chevron.
 */
import type { Sigil } from "sigil-core";
import { resolve as coreResolve } from "sigil-core";

export type EntanglementKind = "neighbor" | "god";

export interface Entanglement {
  name: string;
  kind: EntanglementKind;
  /** Absolute path suitable for navigation (includes `Imported Ontologies` prefix for gods). */
  path: string[];
}

/**
 * Parse a block of markdown for top-level `@Name` references, resolve each
 * against the spec, and return deduplicated entanglements — neighbors and
 * gods only. Children, ancestors, and unresolved refs are filtered out.
 */
export function extractEntanglements(
  text: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
  childNames: string[],
): Entanglement[] {
  const childSet = new Set(childNames);
  const seen = new Map<string, Entanglement>();
  const refRe = /@([A-Za-z][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = refRe.exec(text)) !== null) {
    const name = match[1];
    if (childSet.has(name)) continue;
    if (seen.has(name)) continue;
    const resolution = coreResolve(root, currentPath, `@${name}`, importedOntologies);
    if (!resolution) continue;
    if (resolution.kind === "unresolved" || resolution.kind === "ancestor" || resolution.kind === "contained") continue;
    // Proximity — an explicit @ref that the resolver located by searching
    // the subtree. It's still an explicit reference, just not a sibling or a
    // child, so surface it as a neighbor-shaped icon pointing at the resolved
    // path. (Previously skipped by conflation with co-occurrence.)
    if (resolution.kind === "proximity") {
      const canonical = resolution.target?.name ?? name;
      if (seen.has(canonical)) continue;
      seen.set(canonical, { name: canonical, kind: "neighbor", path: resolution.path });
      continue;
    }
    if (resolution.kind === "lib") {
      // Collapse the ref to its top-level imported ontology — the god itself,
      // not the specific blessing it offers. A reference like @Narration (which
      // resolves inside AttentionLanguage) becomes one entanglement with the
      // AttentionLanguage god, deduped across all such inner refs.
      const godName = resolution.path[0];
      if (!godName) continue;
      const key = `god:${godName}`;
      if (seen.has(key)) continue;
      seen.set(key, { name: godName, kind: "god", path: ["Imported Ontologies", godName] });
      continue;
    }
    // Sibling — a peer neighbor in the main spec tree.
    if (seen.has(name)) continue;
    seen.set(name, { name, kind: "neighbor", path: resolution.path });
  }
  return [...seen.values()];
}

/**
 * Names of sigils referenced by a block of text (an affordance body). Unlike
 * `extractEntanglements`, children are retained — an affordance pointing at
 * a child is the strongest signal of where that affordance reaches. The
 * returned names correspond to icon names on the current desktop:
 * children by their own name, neighbors by their own name, gods collapsed
 * to the top-level imported ontology's name.
 */
export function extractAffordanceTargets(
  text: string,
  root: Sigil,
  currentPath: string[],
  importedOntologies: Sigil | null,
): string[] {
  const seen = new Set<string>();
  const refRe = /@([A-Za-z][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = refRe.exec(text)) !== null) {
    const name = match[1];
    const resolution = coreResolve(root, currentPath, `@${name}`, importedOntologies);
    if (!resolution) continue;
    if (resolution.kind === "unresolved") continue;
    if (resolution.kind === "ancestor") continue; // parent has its own UP button
    if (resolution.kind === "lib") {
      // Collapse to the top-level imported ontology (the god on the desktop).
      const godName = resolution.path[0];
      if (godName) seen.add(godName);
      continue;
    }
    // Use the resolved target's canonical name, not the raw ref text.
    // @user (lowercase) must match the canonical sibling "User" on the desktop.
    const canonical = resolution.target?.name;
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}
