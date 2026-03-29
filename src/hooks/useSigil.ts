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
    const chats = await api.listChats(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);

    // Load the first chat if any exist, otherwise start empty
    let activeChatId = "";
    let chatMessages: { role: "user" | "assistant"; content: string }[] = [];
    if (chats.length > 0) {
      activeChatId = chats[0].id;
      const chat = await api.readChat(rootPath, chats[0].id);
      chatMessages = chat.messages;
    }

    dispatch({
      type: "SET_DOCUMENT",
      doc: {
        sigil,
        currentPath: [],
        editorMode: "split",
        contentTab: "language",
        leftPanelOpen: true,
        leftPanelTab: "tree",
        rightPanelOpen: false,
        chats,
        activeChatId,
        chatMessages,
        chatStreaming: false,
        highlightedChild: null,
        wordWrap: false,
      },
    });
  }, [dispatch]);

  return { reload, openDocument, document: state.document };
}
