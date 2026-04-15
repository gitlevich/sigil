import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage, selectedProvider } from "../tauri";
import { useAppState } from "../state/AppContext";
import { useWorkspaceState } from "../state/WorkspaceContext";
import { useChatState, useChatDispatch } from "../state/ChatContext";
import { useExperience } from "../state/ExperienceContext";
import { useToast } from "./useToast";

export function useChatStream() {
  const appState = useAppState();
  const workspace = useWorkspaceState();
  const chat = useChatState();
  const chatDispatch = useChatDispatch();
  const { addToast } = useToast();
  const { recordChat } = useExperience();
  const recordChatRef = useRef(recordChat);
  recordChatRef.current = recordChat;
  const accumulatorRef = useRef("");
  const workspaceRef = useRef(workspace);
  const chatRef = useRef(chat);
  workspaceRef.current = workspace;
  chatRef.current = chat;

  useEffect(() => {
    const unlistenToken = events.onChatToken((token) => {
      accumulatorRef.current += token;
      const conv = chatRef.current;
      const msgs = [...conv.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      chatDispatch({ type: "SET_MESSAGES", messages: msgs });
    });

    const unlistenError = events.onChatError((error) => {
      addToast(error, "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      accumulatorRef.current = "";
    });

    const unlistenToolUse = events.onChatToolUse((tool) => {
      accumulatorRef.current += `\n\n*Using tool: ${tool.name}*\n`;
      const conv = chatRef.current;
      const msgs = [...conv.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      chatDispatch({ type: "SET_MESSAGES", messages: msgs });
    });

    // Sigil changes and navigation are handled by the workspace layer
    const unlistenSigilChanged = events.onSigilChanged(() => {});
    const unlistenNavigate = events.onNavigateTo(() => {});

    const unlistenEnd = events.onChatStreamEnd(() => {
      const ws = workspaceRef.current;
      const conv = chatRef.current;
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      if (conv.activeChatId && accumulatorRef.current) {
        const msgs = [...conv.chatMessages];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
        } else {
          msgs.push({ role: "assistant", content: accumulatorRef.current });
        }
        api.writeChat(ws.spec.rootPath, {
          id: conv.activeChatId,
          name: conv.chats.find((c) => c.id === conv.activeChatId)?.name || "Chat",
          messages: msgs,
        }).catch(console.error);

        // Record assistant response as experience — !complete
        recordChatRef.current("assistant", accumulatorRef.current);
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
  }, [chatDispatch]);

  const sendMessage = useCallback(async (message: string) => {
    const ws = workspaceRef.current;
    const conv = chatRef.current;

    // If no active chat, create one
    let chatId = conv.activeChatId;
    if (!chatId) {
      chatId = `chat-${Date.now()}`;
      const chatName = `Chat ${conv.chats.length + 1}`;
      const newChats = [...conv.chats, { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 }];
      chatDispatch({ type: "SET_CHATS", chats: newChats });
      chatDispatch({ type: "SET_ACTIVE_CHAT", chatId, messages: conv.chatMessages });
    }

    const newMessages: ChatMessage[] = [
      ...conv.chatMessages,
      { role: "user", content: message },
    ];

    chatDispatch({ type: "SET_MESSAGES", messages: newMessages });
    chatDispatch({ type: "SET_STREAMING", streaming: true });

    // Record user message as experience — !complete
    recordChatRef.current("user", message);

    const chatName = conv.chats.find((c) => c.id === chatId)?.name || `Chat ${conv.chats.length + 1}`;
    await api.writeChat(ws.spec.rootPath, {
      id: chatId,
      name: chatName,
      messages: newMessages,
    });
    accumulatorRef.current = "";

    const provider = selectedProvider(appState.settings);
    if (!provider) {
      addToast("No attention provider enabled. Open Settings to add one.", "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      return;
    }

    const stylePrefix = appState.settings.response_style === "detailed"
      ? ""
      : "CRITICAL STYLE RULES YOU MUST FOLLOW:\n- NEVER use bullet points, numbered lists, or any list formatting.\n- NEVER use headers or bold text.\n- Maximum 3 sentences per response.\n- Write plain short paragraphs only.\n- You are in a conversation. Talk, don't lecture.\n\n";
    const systemPrompt = stylePrefix + appState.settings.system_prompt;

    try {
      await api.sendChatMessage(
        ws.spec.rootPath,
        chatId,
        message,
        provider,
        systemPrompt,
        ws.currentPath
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", errorMsg);
      addToast(errorMsg, "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
    }
  }, [appState.settings, chatDispatch, addToast]);

  return { sendMessage };
}
