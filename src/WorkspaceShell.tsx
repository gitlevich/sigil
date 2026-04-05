/**
 * WorkspaceShell — lives inside all three providers.
 * Wires hooks that need workspace/narrating/conversing state.
 */
import { useRef, useEffect } from "react";
import { useWorkspaceState, useWorkspaceActions } from "./state/WorkspaceContext";
import { useNarratingState } from "./state/NarratingContext";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useAppMenu, MenuWorkspaceRef } from "./hooks/useAppMenu";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { Workspace } from "./components/Workspace/Workspace";

export function WorkspaceShell() {
  const ws = useWorkspaceState();
  const narrating = useNarratingState();
  const { reload } = useWorkspaceActions();

  // File watcher: reload spec on external fs changes
  useFileWatcher(ws.spec.rootPath, async () => {
    await reload();
  });

  // App menu needs refs to workspace + narrating state
  const workspaceRef = useRef<MenuWorkspaceRef | null>(null);
  useEffect(() => {
    workspaceRef.current = { workspace: ws, narrating };
  }, [ws, narrating]);

  useAppMenu(workspaceRef);

  // Persist workspace + narrating state to disk
  useSettingsPersistence(ws, narrating);

  return <Workspace />;
}
