import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, Sigil } from "../tauri";
import { useAppDispatch, useAppState, OpenDocument } from "../state/AppContext";

type UIOverrides = Partial<Pick<OpenDocument,
  "currentPath" | "editorMode" | "contentTab" |
  "ontologyPanelOpen" | "ontologyPanelTab" | "designPartnerPanelOpen" | "designPartnerPanelTab" |
  "activeChatId" | "chatMessages" | "wordWrap" | "collapsedPaths"
>>;

export function useSigil() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  const reload = useCallback(async (rootPath: string) => {
    const sigil = await api.readSigil(rootPath);
    dispatch({ type: "UPDATE_SIGIL", sigil });
    return sigil;
  }, [dispatch]);

  const openDocument = useCallback(async (rootPath: string, overrides: UIOverrides = {}) => {
    const sigil: Sigil = await api.readSigil(rootPath);
    const chats = await api.listChats(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);
    await getCurrentWindow().setTitle(sigil.name).catch(() => {});

    // Default chat: first in list, unless overridden
    let activeChatId = overrides.activeChatId ?? "";
    let chatMessages = overrides.chatMessages ?? [];
    if (!overrides.activeChatId) {
      if (chats.length > 0) {
        activeChatId = chats[0].id;
        const chat = await api.readChat(rootPath, chats[0].id);
        chatMessages = chat.messages;
      }
    }

    dispatch({
      type: "SET_DOCUMENT",
      doc: {
        sigil,
        currentPath: [],
        editorMode: "split",
        contentTab: "language",
        ontologyPanelOpen: true,
        ontologyPanelTab: "ontology",
        designPartnerPanelOpen: false,
        designPartnerPanelTab: "chat",
        chats,
        activeChatId,
        chatMessages,
        chatStreaming: false,
        highlightedChild: null,
        wordWrap: false,
        renamingRequest: false,
        findReferencesName: null,
        collapsedPaths: [],
        ...overrides,
      },
    });
  }, [dispatch]);

  return { reload, openDocument, document: state.document };
}
