import { useCallback } from "react";
import { api, Sigil } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";

export function useSigil() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  const reload = useCallback(async (rootPath: string) => {
    const sigil = await api.readSigil(rootPath);
    dispatch({ type: "UPDATE_SIGIL", sigil });
    return sigil;
  }, [dispatch]);

  const openDocument = useCallback(async (rootPath: string) => {
    const sigil: Sigil = await api.readSigil(rootPath);
    const chatMessages = await api.readChat(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);

    dispatch({
      type: "SET_DOCUMENT",
      doc: {
        sigil,
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
