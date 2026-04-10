/**
 * ChatContext — I entangle with DesignPartner.
 *
 * Chat is foreground — where we talk.
 * Memories is context — what DesignPartner has experienced.
 */
import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import type { ChatMessage, ChatInfo } from "../tauri";

export interface ChatState {
  chats: ChatInfo[];
  activeChatId: string;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
}

type ChatAction =
  | { type: "SET_CHATS"; chats: ChatInfo[] }
  | { type: "SET_ACTIVE_CHAT"; chatId: string; messages: ChatMessage[] }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "APPEND_TOKEN"; token: string }
  | { type: "SET_STREAMING"; streaming: boolean };

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CHATS":
      return { ...state, chats: action.chats };
    case "SET_ACTIVE_CHAT":
      return { ...state, activeChatId: action.chatId, chatMessages: action.messages };
    case "SET_MESSAGES":
      return { ...state, chatMessages: action.messages };
    case "APPEND_TOKEN": {
      const messages = [...state.chatMessages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: last.content + action.token };
      } else {
        messages.push({ role: "assistant", content: action.token });
      }
      return { ...state, chatMessages: messages };
    }
    case "SET_STREAMING":
      return { ...state, chatStreaming: action.streaming };
  }
}

export const DEFAULT_CHAT_STATE: ChatState = {
  chats: [],
  activeChatId: "",
  chatMessages: [],
  chatStreaming: false,
};

const ChatStateContext = createContext<ChatState>(DEFAULT_CHAT_STATE);
const ChatDispatchContext = createContext<Dispatch<ChatAction>>(() => {});

export function ChatProvider({ initial, children }: { initial?: Partial<ChatState>; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_CHAT_STATE, ...initial });

  return (
    <ChatStateContext.Provider value={state}>
      <ChatDispatchContext.Provider value={dispatch}>
        {children}
      </ChatDispatchContext.Provider>
    </ChatStateContext.Provider>
  );
}

export function useChatState() {
  return useContext(ChatStateContext);
}

export function useChatDispatch() {
  return useContext(ChatDispatchContext);
}
