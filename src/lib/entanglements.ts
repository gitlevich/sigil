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
    let kind: EntanglementKind;
    let path: string[];
    if (resolution.kind === "lib") {
      kind = "god";
      // Imported ontology paths need the `Imported Ontologies` prefix for navigation.
      path = ["Imported Ontologies", ...resolution.path];
    } else {
      // sibling or proximity — both are peer neighbors in the main tree.
      kind = "neighbor";
      path = resolution.path;
    }
    seen.set(name, { name, kind, path });
  }
  return [...seen.values()];
}
