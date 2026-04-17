import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage, selectedProvider } from "../tauri";
import { useAppState } from "../state/AppContext";
import { useWorkspaceState } from "../state/WorkspaceContext";
import { useChatState, useChatDispatch } from "../state/ChatContext";
import { useExperience } from "../state/ExperienceContext";
import { useToast } from "./useToast";
import { useNameMisfits, type NameMisfit } from "./useNameMisfits";
import { useHearing, type HearingEvent } from "./useHearing";

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

  // The RightHemisphere's #senses-name-misfit and Hearing are kept current
  // so they can be woven into the DP's system prompt when a message is sent.
  // Per spec: #probe-name-misfit pulls from #senses-name-misfit; the DP
  // should see the list, not only the User.
  const nameMisfits = useNameMisfits(workspace.spec.root, workspace.spec.importedOntologies ?? null);
  const hearingEvents = useHearing(workspace.spec.root);
  const nameMisfitsRef = useRef(nameMisfits);
  const hearingEventsRef = useRef(hearingEvents);
  nameMisfitsRef.current = nameMisfits;
  hearingEventsRef.current = hearingEvents;

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
    const sensorySuffix = composeSensorySection(nameMisfitsRef.current, hearingEventsRef.current);
    const systemPrompt = stylePrefix + appState.settings.system_prompt + sensorySuffix;

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

/**
 * Weave current RightHemisphere signals into the DesignPartner's system prompt.
 * Per spec: #probe-name-misfit pulls from RightHemisphere/#senses-name-misfit,
 * and Hearing reports located events. Both should reach the DP's context, not
 * only the User's UI — otherwise the statistical signal never meets semantic
 * judgment.
 */
function composeSensorySection(misfits: NameMisfit[], events: HearingEvent[]): string {
  if (misfits.length === 0 && events.length === 0) return "";

  const parts: string[] = ["\n\n# Current Sensory State\n"];

  if (misfits.length > 0) {
    parts.push(
      "\n## #senses-name-misfit — names that feel out of place\n\n" +
      "Suspected mis-placed @references. These resolve, but the resolved sigil's co-occurrence neighborhood does not match the surrounding line. Suspicion, not conviction — apply your semantic judgment.\n",
    );
    for (const m of misfits.slice(0, 20)) {
      const loc = m.path.join("/") + "/" + m.file;
      parts.push(`- ${loc}:${m.line} ${m.ref} — ${m.reason}`);
    }
    if (misfits.length > 20) {
      parts.push(`- …and ${misfits.length - 20} more`);
    }
    parts.push("");
  }

  if (events.length > 0) {
    parts.push(
      "\n## Hearing — recent located events\n\n" +
      "Changes to the tree, in reverse chronological order.\n",
    );
    for (const e of events.slice(0, 15)) {
      const loc = e.path.length > 0 ? e.path.join("/") : "(root)";
      parts.push(`- [${e.kind}] ${loc} — ${e.summary}`);
    }
    if (events.length > 15) {
      parts.push(`- …and ${events.length - 15} older`);
    }
  }

  return parts.join("\n");
}
