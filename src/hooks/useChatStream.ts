import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage, selectedProvider } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";
import { useToast } from "./useToast";
import { useSigil } from "./useSigil";

export function useChatStream() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const { addToast } = useToast();
  const { reload } = useSigil();
  const accumulatorRef = useRef("");
  const docRef = useRef(state.document);
  docRef.current = state.document;

  useEffect(() => {
    const unlistenToken = events.onChatToken((token) => {
      accumulatorRef.current += token;
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      const msgs = [...currentDoc.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatMessages: msgs } });
    });

    const unlistenError = events.onChatError((error) => {
      addToast(error, "error");
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      accumulatorRef.current = "";
    });

    const unlistenToolUse = events.onChatToolUse((tool) => {
      // Show tool use as a system message in the chat
      accumulatorRef.current += `\n\n*Using tool: ${tool.name}*\n`;
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      const msgs = [...currentDoc.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatMessages: msgs } });
    });

    const unlistenSigilChanged = events.onSigilChanged(() => {
      const currentDoc = docRef.current;
      if (currentDoc) {
        reload(currentDoc.sigil.root_path).catch(console.error);
      }
    });

    const unlistenNavigate = events.onNavigateTo((sigilPath: string) => {
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      // Convert absolute path to relative path segments from root
      const rootPath = currentDoc.sigil.root_path;
      if (sigilPath.startsWith(rootPath)) {
        const relative = sigilPath.slice(rootPath.length).replace(/^\//, "");
        const segments = relative ? relative.split("/") : [];
        dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: segments } });
      }
    });

    const unlistenEnd = events.onChatStreamEnd(() => {
      const finalDoc = docRef.current;
      if (!finalDoc) return;
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      if (finalDoc.activeChatId && accumulatorRef.current) {
        const msgs = [...finalDoc.chatMessages];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
        } else {
          msgs.push({ role: "assistant", content: accumulatorRef.current });
        }
        api.writeChat(finalDoc.sigil.root_path, {
          id: finalDoc.activeChatId,
          name: finalDoc.chats.find((c) => c.id === finalDoc.activeChatId)?.name || "Chat",
          messages: msgs,
        }).catch(console.error);
      }
      accumulatorRef.current = "";
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolUse.then((fn) => fn());
      unlistenSigilChanged.then((fn) => fn());
      unlistenNavigate.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [dispatch]);

  const sendMessage = useCallback(async (message: string) => {
    const doc = docRef.current;
    if (!doc) return;

    // If no active chat, create one
    let chatId = doc.activeChatId;
    if (!chatId) {
      chatId = `chat-${Date.now()}`;
      const chatName = `Chat ${doc.chats.length + 1}`;
      const newChats = [...doc.chats, { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 }];
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chats: newChats, activeChatId: chatId } });
    }

    const newMessages: ChatMessage[] = [
      ...doc.chatMessages,
      { role: "user", content: message },
    ];

    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { chatMessages: newMessages, chatStreaming: true },
    });

    const chatName = doc.chats.find((c) => c.id === chatId)?.name || `Chat ${doc.chats.length + 1}`;
    await api.writeChat(doc.sigil.root_path, {
      id: chatId,
      name: chatName,
      messages: newMessages,
    });
    accumulatorRef.current = "";

    const provider = selectedProvider(state.settings);
    if (!provider) {
      addToast("No attention provider enabled. Open Settings to add one.", "error");
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      return;
    }

    const stylePrefix = state.settings.response_style === "detailed"
      ? ""
      : "CRITICAL STYLE RULES YOU MUST FOLLOW:\n- NEVER use bullet points, numbered lists, or any list formatting.\n- NEVER use headers or bold text.\n- Maximum 3 sentences per response.\n- Write plain short paragraphs only.\n- You are in a conversation. Talk, don't lecture.\n\n";
    const systemPrompt = stylePrefix + state.settings.system_prompt;

    try {
      await api.sendChatMessage(
        doc.sigil.root_path,
        chatId,
        message,
        provider,
        systemPrompt,
        doc.currentPath
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", errorMsg);
      addToast(errorMsg, "error");
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
    }
  }, [state.settings, dispatch, addToast]);

  return { sendMessage };
}
