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
  const [dragWidth, setDragWidth] = useState<number | null>(null);
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
      <ResizeHandle side="left" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      <div className={styles.panel} style={{ width }}>
        <div className={styles.header}>
          <span className={styles.title}>AI Review</span>
          {(state.settings.profiles?.length ?? 0) > 1 && (
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
          {state.settings.profiles?.length === 1 && (
            <span className={styles.profileLabel}>{state.settings.profiles[0].name}</span>
          )}
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
            title={state.settings.response_style === "laconic" ? "Laconic mode (click to switch to default)" : "Default mode (click to switch to laconic)"}
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
