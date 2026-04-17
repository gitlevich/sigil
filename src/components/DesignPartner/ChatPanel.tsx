import { useState, useRef, useEffect } from "react";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import { useWorkspaceState } from "../../state/WorkspaceContext";
import { useLayoutState } from "../../state/LayoutContext";
import { useChatState, useChatDispatch } from "../../state/ChatContext";
import { useChatStreamContext } from "../../state/ChatStreamContext";
import { api } from "../../tauri";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { MarkdownPreview } from "../Workspace/MarkdownPreview";
import styles from "./ChatPanel.module.css";

function draftKey(rootPath: string, chatId: string): string {
  return `sigil-draft:${rootPath}:${chatId}`;
}

export function ChatPanel() {
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const ws = useWorkspaceState();
  const layout = useLayoutState();
  const chat = useChatState();
  const chatDispatch = useChatDispatch();
  const { sendMessage } = useChatStreamContext();
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(draftKey(ws.spec.rootPath, chat.activeChatId)) || ""; }
    catch { return ""; }
  });
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const chatsLoadedRef = useRef(false);

  // Load chat list from disk on first mount. If there's no active chat yet
  // but previous chats exist, open the most recent one — otherwise the
  // first message spawns a fresh chat each launch and they accumulate.
  useEffect(() => {
    if (chatsLoadedRef.current) return;
    chatsLoadedRef.current = true;
    api.listChats(ws.spec.rootPath).then(async (chats) => {
      if (chats.length === 0) return;
      chatDispatch({ type: "SET_CHATS", chats });

      const savedActiveExists = chat.activeChatId
        && chats.some((c) => c.id === chat.activeChatId);
      if (savedActiveExists) return;

      const mostRecent = chats.reduce(
        (a, b) => (a.last_modified >= b.last_modified ? a : b),
        chats[0],
      );
      const loaded = await api.readChat(ws.spec.rootPath, mostRecent.id).catch(() => null);
      if (loaded) {
        chatDispatch({
          type: "SET_ACTIVE_CHAT",
          chatId: mostRecent.id,
          messages: loaded.messages,
        });
      }
    }).catch(err => {
      console.error("Failed to load chats:", err);
    });
  }, [ws.spec.rootPath, chatDispatch, chat.activeChatId]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevOpen = useRef(layout.designPartnerPanelOpen);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.chatMessages]);

  useEffect(() => {
    if (layout.designPartnerPanelOpen && !prevOpen.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    prevOpen.current = layout.designPartnerPanelOpen;
  }, [layout.designPartnerPanelOpen]);

  // Save draft on every keystroke
  useEffect(() => {
    try { localStorage.setItem(draftKey(ws.spec.rootPath, chat.activeChatId), input); }
    catch { /* ignore */ }
  }, [input, ws.spec.rootPath, chat.activeChatId]);

  // Restore draft when switching chats
  const prevChatId = useRef(chat.activeChatId);
  useEffect(() => {
    if (chat.activeChatId === prevChatId.current) return;
    prevChatId.current = chat.activeChatId;
    try {
      setInput(localStorage.getItem(draftKey(ws.spec.rootPath, chat.activeChatId)) || "");
    } catch { setInput(""); }
  }, [chat.activeChatId, ws.spec.rootPath]);

  useEffect(() => {
    const handleClick = () => setChatMenu(null);
    if (chatMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [chatMenu]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || chat.chatStreaming) return;
    sendMessage(trimmed);
    setInput("");
    try { localStorage.removeItem(draftKey(ws.spec.rootPath, chat.activeChatId)); }
    catch { /* ignore */ }
  };

  const switchChat = async (chatId: string) => {
    try {
      const chat = await api.readChat(ws.spec.rootPath, chatId);
      chatDispatch({ type: "SET_ACTIVE_CHAT", chatId, messages: chat.messages });
    } catch (err) {
      console.error("Failed to switch chat:", err);
    }
  };

  const createChat = () => {
    const chatId = `chat-${Date.now()}`;
    const chatName = `Chat ${chat.chats.length + 1}`;
    const newChats = [...chat.chats, { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 }];
    chatDispatch({ type: "SET_CHATS", chats: newChats });
    chatDispatch({ type: "SET_ACTIVE_CHAT", chatId, messages: [] });
  };

  const deleteChat = async (chatId: string) => {
    try {
      await api.deleteChat(ws.spec.rootPath, chatId);
      const newChats = chat.chats.filter((c) => c.id !== chatId);
      if (chat.activeChatId === chatId) {
        if (newChats.length > 0) {
          const next = newChats[0];
          const chat = await api.readChat(ws.spec.rootPath, next.id);
          chatDispatch({ type: "SET_CHATS", chats: newChats });
          chatDispatch({ type: "SET_ACTIVE_CHAT", chatId: next.id, messages: chat.messages });
        } else {
          chatDispatch({ type: "SET_CHATS", chats: newChats });
          chatDispatch({ type: "SET_ACTIVE_CHAT", chatId: "", messages: [] });
        }
      } else {
        chatDispatch({ type: "SET_CHATS", chats: newChats });
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const renameChat = async (chatId: string) => {
    const found = chat.chats.find((c) => c.id === chatId);
    if (!found) return;
    const newName = prompt("Rename chat:", found.name);
    if (!newName || !newName.trim()) return;
    try {
      await api.renameChat(ws.spec.rootPath, chatId, newName.trim());
      const newChats = chat.chats.map((c) =>
        c.id === chatId ? { ...c, name: newName.trim() } : c
      );
      chatDispatch({ type: "SET_CHATS", chats: newChats });
    } catch (err) {
      console.error("Failed to rename chat:", err);
    }
  };

  const activeChatName = chat.chats.find((c) => c.id === chat.activeChatId)?.name;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {chat.chats.length > 1 ? (
          <select
            className={styles.chatSwitch}
            value={chat.activeChatId}
            onChange={(e) => switchChat(e.target.value)}
            title="Switch between chat conversations"
          >
            {chat.chats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <span
            className={styles.title}
            onDoubleClick={() => chat.activeChatId && renameChat(chat.activeChatId)}
            title="Double-click to rename"
          >
            {activeChatName || "AI Review"}
          </span>
        )}
        <button
          className={styles.newChatBtn}
          onClick={createChat}
          title="Start a new chat conversation"
        >
          +
        </button>
        {chat.activeChatId && chat.chats.length > 0 && (
          <button
            className={styles.chatMenuBtn}
            onClick={(e) => {
              e.stopPropagation();
              setChatMenu(chatMenu ? null : { x: e.clientX, y: e.clientY, chatId: chat.activeChatId });
            }}
            title="Rename or delete this chat"
          >
            ...
          </button>
        )}
        {(() => {
          const enabled = (appState.settings.ai_providers || []).filter((p) => p.enabled);
          if (enabled.length > 1) {
            return (
              <select
                className={styles.profileSwitch}
                value={appState.settings.selected_provider_id}
                onChange={(e) =>
                  appDispatch({
                    type: "SET_SETTINGS",
                    settings: { ...appState.settings, selected_provider_id: e.target.value },
                  })
                }
                title="Choose which AI attention provider responds next"
              >
                {enabled.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            );
          }
          if (enabled.length === 1) {
            return <span className={styles.profileLabel}>{enabled[0].name}</span>;
          }
          return null;
        })()}
        <div
          className={styles.styleSwitch}
          onClick={() =>
            appDispatch({
              type: "SET_SETTINGS",
              settings: {
                ...appState.settings,
                response_style: appState.settings.response_style === "detailed" ? "laconic" : "detailed",
              },
            })
          }
          title={appState.settings.response_style === "detailed"
            ? "Detailed: thorough explanations with full reasoning"
            : "Laconic: a few short sentences, conversation not report"}
        >
          <span className={appState.settings.response_style !== "detailed" ? styles.styleLabelActive : styles.styleLabel}>laconic</span>
          <span className={styles.switchTrack}>
            <span className={`${styles.switchThumb} ${appState.settings.response_style === "detailed" ? styles.switchThumbRight : ""}`} />
          </span>
          <span className={appState.settings.response_style === "detailed" ? styles.styleLabelActive : styles.styleLabel}>detailed</span>
        </div>
      </div>

      {chatMenu && (
        <div
          className={styles.chatContextMenu}
          style={{ right: 8, top: 36 }}
        >
          <button
            className={styles.chatMenuItem}
            onClick={() => { renameChat(chatMenu.chatId); setChatMenu(null); }}
          >
            Rename
          </button>
          <button
            className={styles.chatMenuItemDanger}
            onClick={() => { deleteChat(chatMenu.chatId); setChatMenu(null); }}
          >
            Delete
          </button>
        </div>
      )}

      <div className={styles.messages}>
        {chat.chatMessages.map((msg: { role: string; content: string }, i: number) => (
          <div
            key={i}
            className={`${styles.message} ${msg.role === "user" ? styles.userMsg : styles.assistantMsg}`}
          >
            <div className={styles.messageHeader}>
              <span className={styles.messageRole}>
                {msg.role === "user" ? "You" : "AI"}
              </span>
              <button
                className={styles.copyBtn}
                onClick={() => writeText(msg.content).catch(console.error)}
                title="Copy to clipboard"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="5" y="5" width="8" height="8" rx="1" />
                  <path d="M11 5V3.5C11 2.95 10.55 2.5 10 2.5H3.5C2.95 2.5 2.5 2.95 2.5 3.5V10C2.5 10.55 2.95 11 3.5 11H5" />
                </svg>
              </button>
            </div>
            {msg.role === "assistant" ? (
              <MarkdownPreview content={msg.content} />
            ) : (
              <div className={styles.messageContent}>{msg.content}</div>
            )}
          </div>
        ))}
        {chat.chatStreaming && chat.chatMessages.length > 0 &&
         chat.chatMessages[chat.chatMessages.length - 1].role === "user" && (
          <div className={`${styles.message} ${styles.assistantMsg}`}>
            <div className={styles.messageRole}>AI</div>
            <div className={styles.typing}>Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={5}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the AI to review your sigil..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {chat.chatStreaming ? (
          <button
            className={styles.sendBtn}
            onClick={() => { api.cancelChat().catch(console.error); }}
            aria-label="Stop"
            title="Stop inference"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="4" y="4" width="10" height="10" rx="1" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 14V4M9 4L4.5 8.5M9 4L13.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
