/**
 * WorkspaceShell — lives inside all three providers.
 * Wires hooks that need workspace and layout state.
 */
import { useRef, useEffect } from "react";
import { useWorkspaceState, useWorkspaceActions, useWorkspaceDispatch } from "./state/WorkspaceContext";
import { useLayoutState } from "./state/LayoutContext";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useRightHemisphere } from "./hooks/useRightHemisphere";
import { useAppMenu, MenuWorkspaceRef } from "./hooks/useAppMenu";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { getAutoSavePendingPath, getAutoSavePendingContent, getBase, pauseAutoSaveFor } from "./hooks/useAutoSave";
import { api, FsChangeEvent } from "./tauri";
import { Workspace } from "./components/Workspace/Workspace";
import { ExperienceProvider } from "./state/ExperienceContext";

export function WorkspaceShell() {
  const ws = useWorkspaceState();
  const layout = useLayoutState();
  const dispatch = useWorkspaceDispatch();
  const { reload } = useWorkspaceActions();
  const { perceive, getExperience } = useRightHemisphere(ws.spec, ws.currentPath);

  useFileWatcher(ws.spec.rootPath, async (_rootPath, event: FsChangeEvent) => {
    const pendingPath = getAutoSavePendingPath();

    const newSpec = await reload();

    // RightHemisphere: sense disturbance in the shape.
    perceive(newSpec, event.paths);

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
    <ExperienceProvider getExperience={getExperience}>
      <Workspace />
    </ExperienceProvider>
  );
}
