import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import { Sigil, Settings, ChatMessage, ChatInfo, DEFAULT_KEYBINDINGS } from "../tauri";

export interface OpenDocument {
  sigil: Sigil;
  currentPath: string[];
  editorMode: "edit" | "split" | "preview";
  contentTab: "language" | "atlas";
  leftPanelOpen: boolean;
  leftPanelTab: "vision" | "ontology";
  rightPanelOpen: boolean;
  rightPanelTab: "chat" | "memories";
  chats: ChatInfo[];
  activeChatId: string;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  highlightedChild: string | null;
  wordWrap: boolean;
  renamingRequest: boolean;
  findReferencesName: string | null;
}

export interface UIState {
  leftPanelWidth: number;
  rightPanelWidth: number;
  fontSize: number; // base font size in px
}

export type ThemePreference = "light" | "dark" | "system";

interface AppState {
  screen: "picker" | "editor";
  document: OpenDocument | null;
  settings: Settings;
  settingsOpen: boolean;
  aboutOpen: boolean;
  helpOpen: boolean;
  themePreference: ThemePreference;
  ui: UIState;
}

type Action =
  | { type: "SET_SCREEN"; screen: "picker" | "editor" }
  | { type: "SET_DOCUMENT"; doc: OpenDocument }
  | { type: "CLEAR_DOCUMENT" }
  | { type: "UPDATE_DOCUMENT"; updates: Partial<OpenDocument> }
  | { type: "UPDATE_SIGIL"; sigil: Sigil }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "SET_ABOUT_OPEN"; open: boolean }
  | { type: "SET_HELP_OPEN"; open: boolean }
  | { type: "SET_THEME"; theme: ThemePreference }
  | { type: "SET_UI"; ui: Partial<UIState> };

export const DEFAULT_UI: UIState = {
  leftPanelWidth: 260,
  rightPanelWidth: 400,
  fontSize: 16,
};

const initialState: AppState = {
  screen: "picker",
  document: null,
  settings: {
    ai_providers: [],
    selected_provider_id: "",
    system_prompt: "",
    response_style: "laconic",
    keybindings: DEFAULT_KEYBINDINGS,
  },
  settingsOpen: false,
  aboutOpen: false,
  helpOpen: false,
  themePreference: "system",
  ui: DEFAULT_UI,
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

    case "SET_ABOUT_OPEN":
      return { ...state, aboutOpen: action.open };

    case "SET_HELP_OPEN":
      return { ...state, helpOpen: action.open };

    case "SET_THEME":
      return { ...state, themePreference: action.theme };

    case "SET_UI":
      return { ...state, ui: { ...state.ui, ...action.ui } };

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
