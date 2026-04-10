import { useMemo } from "react";
import { useWorkspaceState, useWorkspaceActions } from "../state/WorkspaceContext";
import { useToast } from "./useToast";
import type { ActionDeps } from "../actions/workspace";

export function useActionDeps(): ActionDeps {
  const ws = useWorkspaceState();
  const { reload } = useWorkspaceActions();
  const { addToast } = useToast();
  return useMemo(() => ({
    rootPath: ws.spec.rootPath,
    reload: async () => { await reload(); },
    addToast,
  }), [ws.spec.rootPath, reload, addToast]);
}
