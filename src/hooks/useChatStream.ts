import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";

export function useChatStream() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const accumulatorRef = useRef("");

  const doc = state.document;

  useEffect(() => {
    const unlistenToken = events.onChatToken((token) => {
      accumulatorRef.current += token;
      if (!doc) return;
      const msgs = [...doc.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatMessages: msgs } });
    });

    const unlistenEnd = events.onChatStreamEnd(() => {
      if (!doc) return;
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      api.writeChat(doc.specTree.root_path, doc.chatMessages).catch(console.error);
      accumulatorRef.current = "";
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [doc, dispatch]);

  const sendMessage = useCallback(async (message: string) => {
    if (!doc) return;

    const newMessages: ChatMessage[] = [
      ...doc.chatMessages,
      { role: "user", content: message },
    ];

    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { chatMessages: newMessages, chatStreaming: true },
    });

    await api.writeChat(doc.specTree.root_path, newMessages);
    accumulatorRef.current = "";

    api.sendChatMessage(
      doc.specTree.root_path,
      message,
      state.settings
    ).catch((err) => {
      console.error("Chat error:", err);
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
    });
  }, [doc, state.settings, dispatch]);

  return { sendMessage };
}
