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
import { getAutoSavePendingPath, getAutoSavePendingContent, getBase, pauseAutoSaveFor } from "./hooks/useAutoSave";
import { api, FsChangeEvent, SigilFolder, IdeaSpec } from "./tauri";
import { useChatStream } from "./hooks/useChatStream";
import { Workspace } from "./components/Workspace/Workspace";
import { ExperienceProvider } from "./state/ExperienceContext";
import { ChatStreamProvider } from "./state/ChatStreamContext";
import { findContext } from "sigil-core";
import type { Sigil } from "sigil-core";
import type { WorkspaceState } from "./state/WorkspaceContext";

/** Patch a disk-read spec: replace the language of the node at `scopePath` with local content. */
function graftLanguage(
  diskSpec: IdeaSpec,
  currentWs: WorkspaceState,
  scopePath: string[],
  localLanguage: string,
): IdeaSpec {
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

  const { perceive, getExperience, recordChat, getMemory } = useRightHemisphere(ws.spec, ws.currentPath, bicameralCallbacks);
  const { sendMessage } = useChatStream();

  useFileWatcher(ws.spec.rootPath, async (_rootPath, event: FsChangeEvent) => {
    const pendingPath = getAutoSavePendingPath();

    // Read fresh spec from disk, but do NOT dispatch yet.
    const diskSpec = await readSpec();

    // Graft: preserve the currently-edited node's language from the local spec tree.
    // The local tree (ws.spec) has the user's latest content (via handleContentChange's
    // 300ms debounce). The disk spec may have stale content for that node because
    // auto-save hasn't caught up yet. We take structure from disk, content from local.
    const currentWs = ws;
    const { scopeRoot, scopePath } = scopeInfo(currentWs);
    const localFolder = findContext(scopeRoot as Sigil, scopePath) as SigilFolder | null;

    let spec: IdeaSpec;
    if (localFolder && scopePath.length > 0) {
      spec = graftLanguage(diskSpec, currentWs, scopePath, localFolder.language);
    } else if (localFolder && scopePath.length === 0) {
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

    // The file being edited was changed externally. Detect conflict.
    const base = getBase(pendingPath);
    if (base === null) return; // No base tracked — cannot detect conflict, skip.

    const localContent = getAutoSavePendingContent() ?? base;

    if (event.kind === "remove") {
      pauseAutoSaveFor(pendingPath);
      dispatch({
        type: "SET_CONFLICT",
        conflict: { path: pendingPath, diskContent: "", localContent, deleted: true },
      });
      return;
    }

    // Read the new disk content to compare against base.
    const diskContent = await api.readFile(pendingPath).catch(() => null);
    if (diskContent === null) return; // File disappeared between event and read.
    if (diskContent === base) return; // Echo of our own write.

    // External process changed the file while user has local edits. Conflict.
    pauseAutoSaveFor(pendingPath);
    dispatch({
      type: "SET_CONFLICT",
      conflict: { path: pendingPath, diskContent, localContent, deleted: false },
    });
  });

  const workspaceRef = useRef<MenuWorkspaceRef | null>(null);
  useEffect(() => {
    workspaceRef.current = { workspace: ws, layout };
  }, [ws, layout]);

  useAppMenu(workspaceRef);

  useSettingsPersistence(ws, layout);

  return (
    <ExperienceProvider handle={{ getExperience, recordChat, getMemory }}>
      <ChatStreamProvider handle={{ sendMessage }}>
        <Workspace />
      </ChatStreamProvider>
    </ExperienceProvider>
  );
}
