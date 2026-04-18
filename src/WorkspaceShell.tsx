/**
 * WorkspaceShell — lives inside all three providers.
 * Wires hooks that need workspace and layout state.
 */
import { useRef, useEffect, useMemo } from "react";
import { useWorkspaceState, useWorkspaceActions, useWorkspaceDispatch, scopeInfo } from "./state/WorkspaceContext";
import { useLayoutState } from "./state/LayoutContext";
import { useChatDispatch } from "./state/ChatContext";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useRightHemisphere } from "./hooks/useRightHemisphere";
import type { BicameralCallbacks } from "./hooks/useRightHemisphere";
import { useAppMenu, MenuWorkspaceRef } from "./hooks/useAppMenu";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { useToast } from "./hooks/useToast";
import { getAutoSavePendingPath, getAutoSavePendingContent, getBase, setBase, pauseAutoSaveFor } from "./hooks/useAutoSave";
import { api, FsChangeEvent, SigilFolder, Idea } from "./tauri";
import { threeWayMergeCounts } from "./lib/mergeCounts";
import { useChatStream } from "./hooks/useChatStream";
import { Workspace } from "./components/Workspace/Workspace";
import { ExperienceProvider } from "./state/ExperienceContext";
import { ChatStreamProvider } from "./state/ChatStreamContext";
import { findContext } from "sigil-core";
import type { Sigil } from "sigil-core";
import type { WorkspaceState } from "./state/WorkspaceContext";

/** Patch a disk-read spec: replace the language of the node at `scopePath` with local content. */
function graftLanguage(
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

export function WorkspaceShell() {
  const ws = useWorkspaceState();
  const layout = useLayoutState();
  const dispatch = useWorkspaceDispatch();
  const chatDispatch = useChatDispatch();
  const { addToast } = useToast();
  const { readSpec } = useWorkspaceActions();

  const bicameralCallbacks = useMemo<BicameralCallbacks>(() => ({
    onArticulation: (articulation) => {
      // #address-user — partner message in chat
      chatDispatch({ type: "SET_MESSAGES_APPEND", message: {
        role: "assistant",
        content: articulation.observation +
          (articulation.suggestions.length > 0
            ? "\n\n" + articulation.suggestions.join("\n")
            : ""),
      }});

      // Notification — visible wherever the user is
      const preview = articulation.observation.length > 80
        ? articulation.observation.slice(0, 80) + "..."
        : articulation.observation;
      addToast(preview, "info");
    },
  }), [chatDispatch, addToast]);

  const { perceive, getExperience, recordChat, recordObservation, getMemory } = useRightHemisphere(ws.spec, ws.currentPath, bicameralCallbacks);
  const { sendMessage } = useChatStream();

  useFileWatcher(ws.spec.rootPath, async (_rootPath, event: FsChangeEvent) => {
    const pendingPath = getAutoSavePendingPath();
    const pendingContent = getAutoSavePendingContent();

    // Buffer dirtiness for the currently-edited file:
    // dirty iff pending content exists AND it diverges from the last-known-disk snapshot.
    // A null pending (no unsaved change) or pending === base both mean the buffer is clean.
    let isBufferDirty = false;
    if (pendingPath) {
      const base = getBase(pendingPath);
      isBufferDirty = base !== null && pendingContent !== null && pendingContent !== base;
    }

    // Read fresh spec from disk, but do NOT dispatch yet.
    const diskSpec = await readSpec();

    // Graft: preserve the currently-edited node's language from the local spec tree ONLY
    // when the buffer is dirty. A clean buffer has no unsaved work to protect — letting
    // fresh disk content flow through is the silent-adopt path.
    const currentWs = ws;
    const { scopeRoot, scopePath } = scopeInfo(currentWs);
    const localFolder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;

    let spec: Idea;
    if (localFolder && isBufferDirty && scopePath.length > 0) {
      spec = graftLanguage(diskSpec, currentWs, scopePath, localFolder.language);
    } else if (localFolder && isBufferDirty && scopePath.length === 0) {
      // Editing the root — graft its language directly
      const isImported = currentWs.currentPath[0] === "Imported Ontologies";
      if (isImported && diskSpec.importedOntologies) {
        spec = { ...diskSpec, importedOntologies: { ...diskSpec.importedOntologies, language: localFolder.language } };
      } else {
        spec = { ...diskSpec, root: { ...diskSpec.root, language: localFolder.language } };
      }
    } else {
      spec = diskSpec;
    }

    dispatch({ type: "UPDATE_SPEC", spec });

    // RightHemisphere: sense disturbance in the shape.
    perceive(spec, event.paths);

    if (!pendingPath) return;

    const pendingMatchesChanged = event.paths.some((p) => p === pendingPath);
    if (!pendingMatchesChanged) return;

    // The file being edited was changed externally. Reconcile.
    const base = getBase(pendingPath);
    if (base === null) return; // No base tracked — cannot reconcile, skip.

    if (event.kind === "remove") {
      if (isBufferDirty) {
        pauseAutoSaveFor(pendingPath);
        dispatch({
          type: "SET_CONFLICT",
          conflict: { path: pendingPath, base, diskContent: "", localContent: pendingContent ?? base, deleted: true, mergedCount: 0, conflictCount: 0 },
        });
      }
      return;
    }

    // Compare disk content to snapshot (content-hash equivalent: byte equality).
    const diskContent = await api.readFile(pendingPath).catch(() => null);
    if (diskContent === null) return; // File disappeared between event and read.
    if (diskContent === base) return; // Echo: no real change relative to snapshot.

    if (!isBufferDirty) {
      // Clean buffer: adopt disk silently. Update base so future checks stay accurate.
      // UPDATE_SPEC already propagated the new content to the editor (no graft taken above).
      setBase(pendingPath, diskContent);
      return;
    }

    // Dirty buffer + disk diverged from snapshot = real conflict.
    const localContent = pendingContent ?? base;
    const { mergedCount, conflictCount } = threeWayMergeCounts(localContent, base, diskContent);
    pauseAutoSaveFor(pendingPath);
    dispatch({
      type: "SET_CONFLICT",
      conflict: { path: pendingPath, base, diskContent, localContent, deleted: false, mergedCount, conflictCount },
    });
  });

  const workspaceRef = useRef<MenuWorkspaceRef | null>(null);
  useEffect(() => {
    workspaceRef.current = { workspace: ws, layout };
  }, [ws, layout]);

  useAppMenu(workspaceRef);

  useSettingsPersistence(ws, layout);

  return (
    <ExperienceProvider handle={{ getExperience, recordChat, recordObservation, getMemory }}>
      <ChatStreamProvider handle={{ sendMessage }}>
        <Workspace />
      </ChatStreamProvider>
    </ExperienceProvider>
  );
}
