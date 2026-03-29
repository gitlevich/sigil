import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import { Sigil, Settings, ChatMessage } from "../tauri";

export interface OpenDocument {
  sigil: Sigil;
  currentPath: string[];
  editorMode: "edit" | "split" | "preview";
  showTechnical: boolean;
  leftPanelOpen: boolean;
  leftPanelTab: "vision" | "tree";
  rightPanelOpen: boolean;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
}

export type ThemePreference = "light" | "dark" | "system";

interface AppState {
  screen: "picker" | "editor";
  document: OpenDocument | null;
  settings: Settings;
  settingsOpen: boolean;
  themePreference: ThemePreference;
}

type Action =
  | { type: "SET_SCREEN"; screen: "picker" | "editor" }
  | { type: "SET_DOCUMENT"; doc: OpenDocument }
  | { type: "CLEAR_DOCUMENT" }
  | { type: "UPDATE_DOCUMENT"; updates: Partial<OpenDocument> }
  | { type: "UPDATE_SIGIL"; sigil: Sigil }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "SET_THEME"; theme: ThemePreference };

const initialState: AppState = {
  screen: "picker",
  document: null,
  settings: {
    provider: "anthropic",
    api_key: "",
    model: "claude-sonnet-4-20250514",
    system_prompt: "",
  },
  settingsOpen: false,
  themePreference: "system",
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, screen: action.screen };

    case "SET_DOCUMENT":
      return { ...state, document: action.doc, screen: "editor" };

    case "CLEAR_DOCUMENT":
      return { ...state, document: null, screen: "picker" };

    case "UPDATE_DOCUMENT":
      if (!state.document) return state;
      return { ...state, document: { ...state.document, ...action.updates } };

    case "UPDATE_SIGIL":
      if (!state.document) return state;
      return { ...state, document: { ...state.document, sigil: action.sigil } };

    case "SET_SETTINGS":
      return { ...state, settings: action.settings };

    case "SET_SETTINGS_OPEN":
      return { ...state, settingsOpen: action.open };

    case "SET_THEME":
      return { ...state, themePreference: action.theme };

    default:
      return state;
  }
}

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}

export function useDocument(): OpenDocument | null {
  return useAppState().document;
}
