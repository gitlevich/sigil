import { useState, useRef, useEffect, useCallback } from "react";
import { useAppState, useAppDispatch, useDocument } from "../../state/AppContext";
import { useChatStream } from "../../hooks/useChatStream";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevOpen = useRef(doc?.rightPanelOpen ?? false);

  const width = state.ui.rightPanelWidth;

  const handleResize = useCallback((delta: number) => {
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta));
    dispatch({ type: "SET_UI", ui: { rightPanelWidth: newWidth } });
  }, [width, dispatch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doc?.chatMessages]);

  // Auto-focus input when panel opens
  useEffect(() => {
    if (doc?.rightPanelOpen && !prevOpen.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    prevOpen.current = doc?.rightPanelOpen ?? false;
  }, [doc?.rightPanelOpen]);

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

  return (
    <>
      <ResizeHandle side="left" onResize={handleResize} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <span className={styles.title}>AI Review</span>
          {state.settings.profiles.length > 1 && (
            <select
              className={styles.profileSwitch}
              value={state.settings.active_profile_id}
              onChange={(e) =>
                dispatch({
                  type: "SET_SETTINGS",
                  settings: { ...state.settings, active_profile_id: e.target.value },
                })
              }
            >
              {state.settings.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {state.settings.profiles.length === 1 && (
            <span className={styles.profileLabel}>{state.settings.profiles[0].name}</span>
          )}
          <button
            className={styles.collapseBtn}
            onClick={() =>
              dispatch({ type: "UPDATE_DOCUMENT", updates: { rightPanelOpen: false } })
            }
          >
            &rsaquo;
          </button>
        </div>

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
            placeholder="Ask the AI to review your spec..."
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
