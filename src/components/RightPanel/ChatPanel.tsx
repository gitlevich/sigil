import { useState, useRef, useEffect, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { useChatStream } from "../../hooks/useChatStream";
import { api } from "../../tauri";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./ChatPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;

export function ChatPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { sendMessage } = useChatStream();
  const [input, setInput] = useState("");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevOpen = useRef(doc?.rightPanelOpen ?? false);

  const committedWidth = state.ui.rightPanelWidth;
  const width = dragWidth ?? committedWidth;

  const handleResize = useCallback((delta: number) => {
    setDragWidth((prev) => {
      const base = prev ?? committedWidth;
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, base + delta));
    });
  }, [committedWidth]);

  const handleResizeEnd = useCallback(() => {
    setDragWidth((prev) => {
      if (prev !== null) {
        dispatch({ type: "SET_UI", ui: { rightPanelWidth: prev } });
      }
      return null;
    });
  }, [dispatch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doc?.chatMessages]);

  useEffect(() => {
    if (doc?.rightPanelOpen && !prevOpen.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    prevOpen.current = doc?.rightPanelOpen ?? false;
  }, [doc?.rightPanelOpen]);

  useEffect(() => {
    const handleClick = () => setChatMenu(null);
    if (chatMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [chatMenu]);

  if (!doc) return null;

  if (!doc.rightPanelOpen) {
    return (
      <div
        className={styles.collapsed}
        onClick={() =>
          dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: true } })
        }
      >
        <span className={styles.collapseIcon}>&lsaquo;</span>
      </div>
    );
  }

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || doc.chatStreaming) return;
    sendMessage(trimmed);
    setInput("");
  };

  const switchChat = async (chatId: string) => {
    try {
      const chat = await api.readChat(doc.sigil.root_path, chatId);
      dispatch({
        type: "UPDATE_DOCUMENT",
        updates: { activeChatId: chatId, chatMessages: chat.messages },
      });
    } catch (err) {
      console.error("Failed to switch chat:", err);
    }
  };

  const createChat = () => {
    const chatId = `chat-${Date.now()}`;
    const chatName = `Chat ${doc.chats.length + 1}`;
    const newChats = [...doc.chats, { id: chatId, name: chatName, message_count: 0 }];
    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { chats: newChats, activeChatId: chatId, chatMessages: [] },
    });
  };

  const deleteChat = async (chatId: string) => {
    try {
      await api.deleteChat(doc.sigil.root_path, chatId);
      const newChats = doc.chats.filter((c) => c.id !== chatId);
      if (doc.activeChatId === chatId) {
        if (newChats.length > 0) {
          const next = newChats[0];
          const chat = await api.readChat(doc.sigil.root_path, next.id);
          dispatch({
            type: "UPDATE_DOCUMENT",
            updates: { chats: newChats, activeChatId: next.id, chatMessages: chat.messages },
          });
        } else {
          dispatch({
            type: "UPDATE_DOCUMENT",
            updates: { chats: newChats, activeChatId: "", chatMessages: [] },
          });
        }
      } else {
        dispatch({ type: "UPDATE_DOCUMENT", updates: { chats: newChats } });
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const renameChat = async (chatId: string) => {
    const chat = doc.chats.find((c) => c.id === chatId);
    if (!chat) return;
    const newName = prompt("Rename chat:", chat.name);
    if (!newName || !newName.trim()) return;
    try {
      await api.renameChat(doc.sigil.root_path, chatId, newName.trim());
      const newChats = doc.chats.map((c) =>
        c.id === chatId ? { ...c, name: newName.trim() } : c
      );
      dispatch({ type: "UPDATE_DOCUMENT", updates: { chats: newChats } });
    } catch (err) {
      console.error("Failed to rename chat:", err);
    }
  };

  const activeChatName = doc.chats.find((c) => c.id === doc.activeChatId)?.name;

  return (
    <>
      <ResizeHandle side="left" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          {doc.chats.length > 1 ? (
            <select
              className={styles.chatSwitch}
              value={doc.activeChatId}
              onChange={(e) => switchChat(e.target.value)}
            >
              {doc.chats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <span className={styles.title}>{activeChatName || "AI Review"}</span>
          )}
          <button
            className={styles.newChatBtn}
            onClick={createChat}
            title="New chat"
          >
            +
          </button>
          {doc.activeChatId && doc.chats.length > 0 && (
            <button
              className={styles.chatMenuBtn}
              onClick={(e) => {
                e.stopPropagation();
                setChatMenu(chatMenu ? null : { x: e.clientX, y: e.clientY, chatId: doc.activeChatId });
              }}
              title="Chat options"
            >
              ...
            </button>
          )}
          {(() => {
            const enabled = (state.settings.attention_providers || []).filter((p) => p.enabled);
            if (enabled.length > 1) {
              return (
                <select
                  className={styles.profileSwitch}
                  value={state.settings.selected_provider_id}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_SETTINGS",
                      settings: { ...state.settings, selected_provider_id: e.target.value },
                    })
                  }
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
          <button
            className={`${styles.styleToggle} ${state.settings.response_style === "laconic" ? styles.styleToggleActive : ""}`}
            onClick={() =>
              dispatch({
                type: "SET_SETTINGS",
                settings: {
                  ...state.settings,
                  response_style: state.settings.response_style === "laconic" ? "default" : "laconic",
                },
              })
            }
            title={state.settings.response_style === "laconic" ? "Laconic mode" : "Default mode"}
          >
            {state.settings.response_style === "laconic" ? "L" : "D"}
          </button>
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: false } })
            }
          >
            &rsaquo;
          </button>
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
          {doc.chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`${styles.message} ${msg.role === "user" ? styles.userMsg : styles.assistantMsg}`}
            >
              <div className={styles.messageRole}>
                {msg.role === "user" ? "You" : "AI"}
              </div>
              {msg.role === "assistant" ? (
                <MarkdownPreview content={msg.content} />
              ) : (
                <div className={styles.messageContent}>{msg.content}</div>
              )}
            </div>
          ))}
          {doc.chatStreaming && doc.chatMessages.length > 0 &&
           doc.chatMessages[doc.chatMessages.length - 1].role === "user" && (
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
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={doc.chatStreaming || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
