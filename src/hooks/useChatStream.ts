import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage, activeProfile } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";
import { useToast } from "./useToast";

export function useChatStream() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const { addToast } = useToast();
  const accumulatorRef = useRef("");
  // Use refs so event listeners always see current state without re-registering
  const docRef = useRef(state.document);
  docRef.current = state.document;

  // Register event listeners once, use refs to access current state
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

    const unlistenEnd = events.onChatStreamEnd(() => {
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      // Read messages from the ref to get the final accumulated state
      const finalDoc = docRef.current;
      if (finalDoc) {
        api.writeChat(finalDoc.sigil.root_path, finalDoc.chatMessages).catch(console.error);
      }
      accumulatorRef.current = "";
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [dispatch]); // Only depends on dispatch (stable)

  const sendMessage = useCallback(async (message: string) => {
    const doc = docRef.current;
    if (!doc) return;

    const newMessages: ChatMessage[] = [
      ...doc.chatMessages,
      { role: "user", content: message },
    ];

    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { chatMessages: newMessages, chatStreaming: true },
    });

    await api.writeChat(doc.sigil.root_path, newMessages);
    accumulatorRef.current = "";

    const profile = activeProfile(state.settings);
    if (!profile) {
      addToast("No AI profile configured. Open Settings to add one.", "error");
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chatStreaming: false } });
      return;
    }

    try {
      await api.sendChatMessage(
        doc.sigil.root_path,
        message,
        profile,
        state.settings.system_prompt
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
