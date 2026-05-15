/**
 * ChatStreamContext — keeps the chat stream alive regardless of which tab is active.
 *
 * The stream listeners must never unmount during a conversation.
 * This context is provided by WorkspaceShell (always mounted) so that
 * ChatPanel can send messages without owning the stream lifecycle.
 */
import { createContext, useContext, ReactNode } from "react";
import type { ChatAttachment } from "../tauri";

interface ChatStreamHandle {
  sendMessage: (message: string, attachments?: ChatAttachment[]) => Promise<void>;
}

const ChatStreamContext = createContext<ChatStreamHandle>({
  sendMessage: async () => {},
});

export function ChatStreamProvider({ handle, children }: { handle: ChatStreamHandle; children: ReactNode }) {
  return (
    <ChatStreamContext.Provider value={handle}>
      {children}
    </ChatStreamContext.Provider>
  );
}

export function useChatStreamContext(): ChatStreamHandle {
  return useContext(ChatStreamContext);
}
