import { useCallback } from "react";
import { api, SpecTree } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";

export function useSpecTree() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  const reload = useCallback(async (rootPath: string) => {
    const specTree = await api.readSpecTree(rootPath);
    dispatch({ type: "UPDATE_SPEC_TREE", specTree });
    return specTree;
  }, [dispatch]);

  const openDocument = useCallback(async (rootPath: string) => {
    const specTree: SpecTree = await api.readSpecTree(rootPath);
    const chatMessages = await api.readChat(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);

    dispatch({
      type: "SET_DOCUMENT",
      doc: {
        specTree,
        currentPath: [],
        editorMode: "split",
        showTechnical: false,
        leftPanelOpen: true,
        leftPanelTab: "tree",
        rightPanelOpen: false,
        chatMessages,
        chatStreaming: false,
      },
    });
  }, [dispatch]);

  return { reload, openDocument, document: state.document };
}
