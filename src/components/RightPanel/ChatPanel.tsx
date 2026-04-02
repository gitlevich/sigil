import { useState, useRef, useEffect, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { useChatStream } from "../../hooks/useChatStream";
import { api } from "../../tauri";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./ChatPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;

function draftKey(rootPath: string, chatId: string): string {
  return `sigil-draft:${rootPath}:${chatId}`;
}

export function ChatPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { sendMessage } = useChatStream();
  const [input, setInput] = useState(() => {
    if (!doc) return "";
    try { return localStorage.getItem(draftKey(doc.sigil.root_path, doc.activeChatId)) || ""; }
    catch { return ""; }
  });
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

  // Save draft on every keystroke
  useEffect(() => {
    if (!doc) return;
    try { localStorage.setItem(draftKey(doc.sigil.root_path, doc.activeChatId), input); }
    catch { /* ignore */ }
  }, [input, doc?.sigil.root_path, doc?.activeChatId]);

  // Restore draft when switching chats
  const prevChatId = useRef(doc?.activeChatId);
  useEffect(() => {
    if (!doc || doc.activeChatId === prevChatId.current) return;
    prevChatId.current = doc.activeChatId;
    try {
      setInput(localStorage.getItem(draftKey(doc.sigil.root_path, doc.activeChatId)) || "");
    } catch { setInput(""); }
  }, [doc?.activeChatId, doc?.sigil.root_path]);

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
    try { localStorage.removeItem(draftKey(doc.sigil.root_path, doc.activeChatId)); }
    catch { /* ignore */ }
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
    const newChats = [...doc.chats, { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 }];
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
              title="Switch between chat conversations"
            >
              {doc.chats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <span
              className={styles.title}
              onDoubleClick={() => doc.activeChatId && renameChat(doc.activeChatId)}
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
          {doc.activeChatId && doc.chats.length > 0 && (
            <button
              className={styles.chatMenuBtn}
              onClick={(e) => {
                e.stopPropagation();
                setChatMenu(chatMenu ? null : { x: e.clientX, y: e.clientY, chatId: doc.activeChatId });
              }}
              title="Rename or delete this chat"
            >
              ...
            </button>
          )}
          {(() => {
            const enabled = (state.settings.ai_providers || []).filter((p) => p.enabled);
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
              dispatch({
                type: "SET_SETTINGS",
                settings: {
                  ...state.settings,
                  response_style: state.settings.response_style === "detailed" ? "laconic" : "detailed",
                },
              })
            }
            title={state.settings.response_style === "detailed"
              ? "Detailed: thorough explanations with full reasoning"
              : "Laconic: a few short sentences, conversation not report"}
          >
            <span className={state.settings.response_style !== "detailed" ? styles.styleLabelActive : styles.styleLabel}>laconic</span>
            <span className={styles.switchTrack}>
              <span className={`${styles.switchThumb} ${state.settings.response_style === "detailed" ? styles.switchThumbRight : ""}`} />
            </span>
            <span className={state.settings.response_style === "detailed" ? styles.styleLabelActive : styles.styleLabel}>detailed</span>
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: false } })
            }
            title="Collapse chat panel"
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
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={doc.chatStreaming || !input.trim()}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 14V4M9 4L4.5 8.5M9 4L13.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
