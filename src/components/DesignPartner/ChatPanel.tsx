import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import { useWorkspaceState } from "../../state/WorkspaceContext";
import { useLayoutState } from "../../state/LayoutContext";
import { useChatState, useChatDispatch } from "../../state/ChatContext";
import { useChatStreamContext } from "../../state/ChatStreamContext";
import { api, selectedProvider, type ChatAttachment } from "../../tauri";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { MarkdownPreview } from "../Workspace/MarkdownPreview";
import { IncreaseResolutionDot } from "./IncreaseResolutionDot";
import { useToast } from "../../hooks/useToast";
import styles from "./ChatPanel.module.css";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Whether the active attention provider can see images. Anthropic Claude 3+
 * and OpenAI GPT-4o-class models do; the embedded sidecar and stock Ollama
 * text models do not. Used to warn the @user before they ship pixels at a
 * tier that won't see them.
 */
function providerSeesImages(provider: string | undefined): boolean {
  return provider === "anthropic" || provider === "openai";
}

/**
 * Copy text to the system clipboard. Tries the web-standard navigator API
 * first (works inside the Tauri webview without round-tripping to Rust),
 * then falls back to the Tauri plugin if the navigator path is unavailable
 * or denied. Surfaces success and failure as a toast so the @user knows
 * what happened — silent failure was the previous behavior.
 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.warn("navigator.clipboard.writeText failed, falling back:", err);
    }
  }
  await writeText(text);
}

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
  const { addToast } = useToast();
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(draftKey(ws.spec.rootPath, chat.activeChatId)) || ""; }
    catch { return ""; }
  });
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [chatRenameDraft, setChatRenameDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(110);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number; lastHeight: number } | null>(null);
  const pendingResizeScrollDeltaRef = useRef(0);
  const chatRenameInputRef = useRef<HTMLInputElement>(null);
  const chatRenameClosedRef = useRef(false);
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
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevOpen = useRef(layout.designPartnerPanelOpen);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.chatMessages]);

  useLayoutEffect(() => {
    const delta = pendingResizeScrollDeltaRef.current;
    const messages = messagesRef.current;
    if (!delta || !messages) return;
    pendingResizeScrollDeltaRef.current = 0;
    messages.scrollTop += delta;
  }, [textareaHeight]);

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
    if (!renamingChatId) return;
    if (chat.chats.some((c) => c.id === renamingChatId)) return;
    setRenamingChatId(null);
    setChatRenameDraft("");
  }, [chat.chats, renamingChatId]);

  useEffect(() => {
    if (renamingChatId !== chat.activeChatId) return;
    const input = chatRenameInputRef.current;
    input?.focus();
    input?.select();
  }, [renamingChatId, chat.activeChatId]);

  const startRenameChat = (chatId: string) => {
    const found = chat.chats.find((c) => c.id === chatId);
    if (!found) return;
    chatRenameClosedRef.current = false;
    setRenamingChatId(chatId);
    setChatRenameDraft(found.name);
  };

  const cancelRenameChat = () => {
    chatRenameClosedRef.current = true;
    setRenamingChatId(null);
    setChatRenameDraft("");
  };

  const commitRenameChat = async (chatId: string, value: string) => {
    if (chatRenameClosedRef.current) return;
    chatRenameClosedRef.current = true;
    setRenamingChatId(null);
    setChatRenameDraft("");

    const newName = value.trim();
    const found = chat.chats.find((c) => c.id === chatId);
    if (!found || !newName || newName === found.name) return;

    try {
      await api.renameChat(ws.spec.rootPath, chatId, newName);
      chatDispatch({
        type: "SET_CHATS",
        chats: chat.chats.map((c) => (c.id === chatId ? { ...c, name: newName } : c)),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Rename failed: ${msg}`, "error");
    }
  };

  /**
   * Ensure a chat exists before persisting attachments — the on-disk path for
   * an attachment includes the chat id, so the chat must be created lazily
   * here rather than waiting for #send.
   */
  const ensureActiveChatId = (): string => {
    if (chat.activeChatId) return chat.activeChatId;
    const chatId = `chat-${Date.now()}`;
    const chatName = `Chat ${chat.chats.length + 1}`;
    const newChats = [
      ...chat.chats,
      { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 },
    ];
    chatDispatch({ type: "SET_CHATS", chats: newChats });
    chatDispatch({ type: "SET_ACTIVE_CHAT", chatId, messages: chat.chatMessages });
    return chatId;
  };

  const addAttachmentFromFile = async (file: File) => {
    if (!isImageFile(file.name || "image.png")) {
      addToast(`Unsupported file: ${file.name || "(unnamed)"}`, "error");
      return;
    }
    try {
      const chatId = ensureActiveChatId();
      const buffer = await file.arrayBuffer();
      const data = Array.from(new Uint8Array(buffer));
      const filename = file.name || `clipboard-${Date.now()}.png`;
      const saved = await api.saveChatAttachmentFromBytes(ws.spec.rootPath, chatId, filename, data);
      setPendingAttachments((prev) => [...prev, saved]);
    } catch (err) {
      addToast(`Attach failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const addAttachmentFromPath = async (path: string) => {
    const filename = path.split(/[\\/]/).pop() || path;
    if (!isImageFile(filename)) {
      addToast(`Unsupported file: ${filename}`, "error");
      return;
    }
    try {
      const chatId = ensureActiveChatId();
      const saved = await api.saveChatAttachmentFromPath(ws.spec.rootPath, chatId, path);
      setPendingAttachments((prev) => [...prev, saved]);
    } catch (err) {
      addToast(`Attach failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const chooseAttachment = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
        ],
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      for (const path of paths) {
        await addAttachmentFromPath(path);
      }
    } catch (err) {
      addToast(`Attach failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;
    let attached = 0;
    for (const file of Array.from(files)) {
      if (!isImageFile(file.name || "clipboard.png")) continue;
      addAttachmentFromFile(file);
      attached += 1;
    }
    if (attached > 0) e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      addAttachmentFromFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  };

  /**
   * Drag the top edge of the input bubble to grow the textarea upward. The
   * neighbor (the messages list above) absorbs the change because it lives
   * in a flex column with flex: 1, so it shrinks rather than being pushed
   * off-screen. The textarea height is clamped against the panel's height
   * so the bubble can never exceed available space.
   */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStateRef.current = { startY: e.clientY, startHeight: textareaHeight, lastHeight: textareaHeight };
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = state.startY - ev.clientY; // dragging up = positive = grow
      const next = state.startHeight + delta;
      const panel = panelRef.current;
      const inputArea = inputAreaRef.current;
      // Reserved overhead = whatever the bubble contains besides the textarea
      // (resize handle, paddings, attachment strip, send control). Measuring
      // it directly keeps the clamp honest as those parts grow or shrink.
      const overhead = inputArea && inputArea.offsetHeight > textareaHeight
        ? inputArea.offsetHeight - textareaHeight + 24
        : 80;
      const maxH = panel ? Math.max(60, panel.clientHeight - overhead) : 600;
      const clamped = Math.max(40, Math.min(maxH, next));
      pendingResizeScrollDeltaRef.current += clamped - state.lastHeight;
      state.lastHeight = clamped;
      setTextareaHeight(clamped);
    };

    const onUp = () => {
      resizeStateRef.current = null;
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    const trimmed = input.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!trimmed && !hasAttachments) || chat.chatStreaming) return;

    if (hasAttachments) {
      const provider = selectedProvider(appState.settings);
      if (!providerSeesImages(provider?.provider)) {
        addToast(
          "Active attention provider has no vision. Switch to Claude or GPT-4o to ask about images.",
          "info",
        );
      }
    }

    sendMessage(trimmed, hasAttachments ? pendingAttachments : undefined).catch((err) => {
      console.error("Send message failed:", err);
    });
    setInput("");
    setPendingAttachments([]);
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
    chatRenameClosedRef.current = false;
    setRenamingChatId(chatId);
    setChatRenameDraft(chatName);
  };

  /**
   * Snapshot the current chat into a numbered sibling and continue from
   * here. Active chat keeps its name and history; the snapshot wears
   * "{name} N". Backend assigns N. List refreshes; user stays on this chat.
   */
  const forkChat = async (chatId: string) => {
    try {
      const snapshot = await api.forkChat(ws.spec.rootPath, chatId);
      const refreshed = await api.listChats(ws.spec.rootPath);
      chatDispatch({ type: "SET_CHATS", chats: refreshed });
      addToast(`Snapshotted as ${snapshot.name}`, "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Fork failed: ${msg}`, "error");
    }
  };

  const activeChatName = chat.chats.find((c) => c.id === chat.activeChatId)?.name;
  const isRenamingActiveChat = !!chat.activeChatId && renamingChatId === chat.activeChatId;

  return (
    <div className={styles.panel} ref={panelRef}>
      <div className={styles.header}>
        <div className={styles.chatPicker}>
          {isRenamingActiveChat ? (
            <input
              ref={chatRenameInputRef}
              className={`${styles.chatCurrent} ${styles.chatRenameInput}`}
              value={chatRenameDraft}
              onChange={(e) => setChatRenameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRenameChat(chat.activeChatId, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRenameChat();
                }
              }}
              onBlur={(e) => commitRenameChat(chat.activeChatId, e.currentTarget.value)}
              aria-label="Rename current chat"
            />
          ) : chat.chats.length > 1 ? (
            <select
              className={`${styles.chatCurrent} ${styles.chatSwitch}`}
              value={chat.activeChatId}
              onChange={(e) => switchChat(e.target.value)}
              title="Switch between chat conversations"
              aria-label="Current chat"
            >
              {chat.chats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              className={`${styles.chatCurrent} ${styles.chatNameButton}`}
              onClick={() => chat.activeChatId && startRenameChat(chat.activeChatId)}
              disabled={!chat.activeChatId}
              title={chat.activeChatId ? "Rename chat" : "Current chat"}
            >
              {activeChatName || "AI Review"}
            </button>
          )}
          {!isRenamingActiveChat && (
            <button
              type="button"
              className={styles.chatRenameBtn}
              onClick={() => chat.activeChatId && startRenameChat(chat.activeChatId)}
              disabled={!chat.activeChatId}
              aria-label="Rename chat"
              title="Rename chat"
            >
              <svg
                className={styles.chatRenameIcon}
                viewBox="0 0 20 20"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4.5 14.7 4 17l2.3-.5 8.9-8.9-1.8-1.8-8.9 8.9Z" />
                <path d="m12.3 4.9 1.8-1.8 1.8 1.8-1.8 1.8" />
              </svg>
            </button>
          )}
        </div>
        {(appState.settings.fork_enabled ?? true) && chat.activeChatId && (
          <button
            className={styles.newChatBtn}
            onClick={() => chat.activeChatId && forkChat(chat.activeChatId)}
            title="Fork: snapshot the current chat into a numbered sibling and continue from here"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="4.5" cy="3.5" r="1.5" />
              <circle cx="11.5" cy="3.5" r="1.5" />
              <circle cx="8" cy="12.5" r="1.5" />
              <path d="M4.5 5 L4.5 7 Q4.5 9 6.5 9 L9.5 9 Q11.5 9 11.5 7 L11.5 5" />
              <path d="M8 9 L8 11" />
            </svg>
          </button>
        )}
        <button
          className={styles.newChatBtn}
          onClick={createChat}
          title="Start a new chat conversation"
        >
          +
        </button>
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

      <div className={styles.messages} ref={messagesRef}>
        {chat.chatMessages.map((msg, i) => (
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
                onClick={() => {
                  copyToClipboard(msg.content)
                    .then(() => addToast("Copied", "info"))
                    .catch((err) => {
                      console.error("Copy failed:", err);
                      addToast("Copy failed", "error");
                    });
                }}
                title="Copy to clipboard"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="5" y="5" width="8" height="8" rx="1" />
                  <path d="M11 5V3.5C11 2.95 10.55 2.5 10 2.5H3.5C2.95 2.5 2.5 2.95 2.5 3.5V10C2.5 10.55 2.95 11 3.5 11H5" />
                </svg>
              </button>
            </div>
            {msg.role === "assistant" ? (
              <AssistantBody content={msg.content} />
            ) : (
              <div className={styles.messageContent}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <AttachmentStrip attachments={msg.attachments} variant="message" />
                )}
                {msg.content}
              </div>
            )}
          </div>
        ))}
        {chat.chatStreaming && chat.chatMessages.length > 0 &&
         chat.chatMessages[chat.chatMessages.length - 1].role === "user" && (
          <div className={`${styles.message} ${styles.assistantMsg}`}>
            <div className={styles.messageRole}>AI</div>
            <div className={styles.typing}>
              {appState.resolutionIncrease.kind === "in-flight" || appState.resolutionIncrease.kind === "unserved"
                ? <IncreaseResolutionDot variant="inline" />
                : "Thinking..."}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        ref={inputAreaRef}
        className={`${styles.inputArea} ${isDragging ? styles.inputAreaDrop : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
      >
        <div
          className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ""}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize chat input"
          title="Drag to resize"
        />
        {pendingAttachments.length > 0 && (
          <AttachmentStrip
            attachments={pendingAttachments}
            variant="pending"
            onRemove={removePendingAttachment}
          />
        )}
        <div className={styles.inputRow}>
          <textarea
            ref={inputRef}
            className={styles.input}
            style={{ height: `${textareaHeight}px` }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="Ask the AI to review your sigil... (paste or drop an image to show it)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            className={styles.sendBtn}
            onClick={chooseAttachment}
            disabled={chat.chatStreaming}
            aria-label="Attach image"
            title="Attach image"
          >
            <svg
              className={styles.sendIcon}
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18.5 11.2 11 18.7a4.2 4.2 0 0 1-5.9-5.9l9.1-9.1a2.9 2.9 0 0 1 4.1 4.1L9.2 16.9a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" />
            </svg>
          </button>
          {chat.chatStreaming ? (
            <button
              className={styles.sendBtn}
              onClick={() => { api.cancelChat().catch(console.error); }}
              aria-label="Stop"
              title="Stop inference"
            >
              <svg
                className={styles.sendIcon}
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="8" y="8" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!input.trim() && pendingAttachments.length === 0}
              aria-label="Send"
              title="Send (Enter)"
            >
              <svg
                className={styles.sendIcon}
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 8 6 12l4 4" />
                <path d="M6 12h10a4 4 0 0 0 4-4V5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Assistant message body — extracts tool-use markers and renders them as
 * subtle action chips, passes the remaining prose through markdown.
 * "*Using tool: delete_sigil*" becomes its own affordance rather than
 * italic text interrupting the reply.
 */
function AssistantBody({ content }: { content: string }) {
  const { prose, tools } = extractToolUses(content);
  return (
    <>
      {tools.length > 0 && (
        <div className={styles.toolChips}>
          {tools.map((tool, i) => (
            <span key={i} className={styles.toolChip} title={`Used tool: ${tool}`}>
              <span className={styles.toolChipGlyph} aria-hidden>↳</span>
              {tool}
            </span>
          ))}
        </div>
      )}
      {prose.trim() && <MarkdownPreview content={prose} />}
    </>
  );
}

function extractToolUses(content: string): { prose: string; tools: string[] } {
  const tools: string[] = [];
  const pattern = /^\s*\*Using tool:\s*([^*\n]+?)\s*\*\s*$/gm;
  const prose = content.replace(pattern, (_, name: string) => {
    tools.push(name.trim());
    return "";
  });
  return { prose, tools };
}

/**
 * A row of image thumbnails. Used in two places: above the chat input as a
 * preview of pending attachments (with remove controls), and inline on past
 * user messages (read-only). The variant decides which.
 */
function AttachmentStrip({
  attachments,
  variant,
  onRemove,
}: {
  attachments: ChatAttachment[];
  variant: "pending" | "message";
  onRemove?: (index: number) => void;
}) {
  return (
    <div className={styles.attachmentStrip}>
      {attachments.map((att, i) => (
        <AttachmentThumb
          key={`${att.path}:${i}`}
          attachment={att}
          onRemove={variant === "pending" && onRemove ? () => onRemove(i) : undefined}
        />
      ))}
    </div>
  );
}

function AttachmentThumb({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.readImageBase64(attachment.path)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attachment.path]);

  const filename = attachment.path.split("/").pop() || "image";

  return (
    <div className={styles.attachmentThumb} title={filename}>
      {dataUrl ? (
        <img src={dataUrl} alt={filename} />
      ) : failed ? (
        <div className={styles.attachmentThumbFallback}>{filename}</div>
      ) : (
        <div className={styles.attachmentThumbLoading} />
      )}
      {onRemove && (
        <button
          className={styles.attachmentRemove}
          onClick={onRemove}
          aria-label="Remove attachment"
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  );
}
