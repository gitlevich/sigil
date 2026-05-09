import type { Idea, SigilFolder } from "./tauri";
import type { WorkspaceState } from "./state/WorkspaceContext";

/** Patch a disk-read spec: replace the language of the node at `scopePath` with local content. */
export function graftLanguage(
  diskSpec: Idea,
  currentWs: WorkspaceState,
  scopePath: string[],
  localLanguage: string,
): Idea {
  const isImported = currentWs.currentPath[0] === "Imported Ontologies";
  const tree = isImported ? diskSpec.importedOntologies : diskSpec.root;
  if (!tree) return diskSpec;
  const patched = patchNode(tree, scopePath, localLanguage);
  if (isImported) return { ...diskSpec, importedOntologies: patched };
  return { ...diskSpec, root: patched };
}

function patchNode(node: SigilFolder, path: string[], language: string): SigilFolder {
  if (path.length === 0) return { ...node, language };
  const [head, ...rest] = path;
  return {
    ...node,
    children: node.children.map((child) =>
      child.name === head ? patchNode(child, rest, language) : child
    ),
  };
}

export function isVisionPath(rootPath: string, path: string | null): boolean {
  return path === `${rootPath}/vision.md`;
}

export function graftDirtyPendingBuffer(
  diskSpec: Idea,
  currentWs: WorkspaceState,
  pendingPath: string | null,
  pendingContent: string | null,
  isBufferDirty: boolean,
  localFolder: SigilFolder | null,
  scopePath: string[],
): Idea {
  if (!isBufferDirty || pendingPath === null || pendingContent === null) {
    return diskSpec;
  }

  if (isVisionPath(currentWs.spec.rootPath, pendingPath)) {
    return { ...diskSpec, vision: pendingContent };
  }

  if (!localFolder) return diskSpec;
  return graftLanguage(diskSpec, currentWs, scopePath, localFolder.language);
}
