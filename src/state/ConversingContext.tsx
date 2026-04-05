/**
 * ConversingContext — I entangle with DesignPartner.
 *
 * Chat is foreground — where we talk.
 * Memories is context — what DesignPartner has experienced.
 */
import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import type { ChatMessage, ChatInfo } from "../tauri";

export interface ConversingState {
  chats: ChatInfo[];
  activeChatId: string;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
}

type ConversingAction =
  | { type: "SET_CHATS"; chats: ChatInfo[] }
  | { type: "SET_ACTIVE_CHAT"; chatId: string; messages: ChatMessage[] }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "APPEND_TOKEN"; token: string }
  | { type: "SET_STREAMING"; streaming: boolean };

function reducer(state: ConversingState, action: ConversingAction): ConversingState {
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

export const DEFAULT_CONVERSING_STATE: ConversingState = {
  chats: [],
  activeChatId: "",
  chatMessages: [],
  chatStreaming: false,
};

const ConversingStateContext = createContext<ConversingState>(DEFAULT_CONVERSING_STATE);
const ConversingDispatchContext = createContext<Dispatch<ConversingAction>>(() => {});

export function ConversingProvider({ initial, children }: { initial?: Partial<ConversingState>; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_CONVERSING_STATE, ...initial });

  return (
    <ConversingStateContext.Provider value={state}>
      <ConversingDispatchContext.Provider value={dispatch}>
        {children}
      </ConversingDispatchContext.Provider>
    </ConversingStateContext.Provider>
  );
}

export function useConversingState() {
  return useContext(ConversingStateContext);
}

export function useConversingDispatch() {
  return useContext(ConversingDispatchContext);
}
