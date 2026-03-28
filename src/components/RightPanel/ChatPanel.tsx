import { useState, useRef, useEffect, useCallback } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { useChatStream } from "../../hooks/useChatStream";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import { ResizeHandle } from "../shared/ResizeHandle";
import styles from "./ChatPanel.module.css";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 340;

export function ChatPanel() {
  const dispatch = useAppDispatch();
  const doc = useDocument();
  const { sendMessage } = useChatStream();
  const [input, setInput] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleResize = useCallback((delta: number) => {
    setWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + delta)));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doc?.chatMessages]);

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
