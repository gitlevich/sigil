/**
 * WorkspaceShell — lives inside all three providers.
 * Wires hooks that need workspace and layout state.
 */
import { useRef, useEffect } from "react";
import { useWorkspaceState, useWorkspaceActions } from "./state/WorkspaceContext";
import { useLayoutState } from "./state/LayoutContext";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useAppMenu, MenuWorkspaceRef } from "./hooks/useAppMenu";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { Workspace } from "./components/Workspace/Workspace";

export function WorkspaceShell() {
  const ws = useWorkspaceState();
  const layout = useLayoutState();
  const { reload } = useWorkspaceActions();

  useFileWatcher(ws.spec.rootPath, async () => {
    await reload();
  });

  const workspaceRef = useRef<MenuWorkspaceRef | null>(null);
  useEffect(() => {
    workspaceRef.current = { workspace: ws, layout };
  }, [ws, layout]);

  useAppMenu(workspaceRef);

  useSettingsPersistence(ws, layout);

  return <Workspace />;
}
