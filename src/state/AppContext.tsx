/**
 * AppContext — top-level application state.
 *
 * Composes the workspace-independent concerns: screen (picker vs workspace),
 * settings, dialogs, theme, and UI layout (panel widths, font size).
 *
 * Workspace-specific state lives in WorkspaceContext, LayoutContext,
 * and ChatContext — provided when a workspace is open.
 */
import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import { Settings, DEFAULT_KEYBINDINGS } from "../tauri";

export interface UIState {
  ontologyPanelWidth: number;
  designPartnerPanelWidth: number;
  fontSize: number;
}

export type ThemePreference = "light" | "dark" | "system";

/**
 * Visible trace of the @LeftHemisphere's #increase-resolution attempt.
 *
 *  - "rest": local capacity was enough, or escalation is not happening.
 *  - "unserved": local attempted, no fallback configured — the @user sees a
 *    brief orange glow, nothing runs at higher resolution.
 *  - "in-flight": fallback is handling the signal; glow pulses in the
 *    fallback's accent color while the connection is live.
 */
export type ResolutionIncreaseState = "rest" | "unserved" | "in-flight";

interface AppState {
  screen: "picker" | "workspace";
  settings: Settings;
  settingsOpen: boolean;
  aboutOpen: boolean;
  helpOpen: boolean;
  themePreference: ThemePreference;
  ui: UIState;
  resolutionIncrease: ResolutionIncreaseState;
}

type Action =
  | { type: "SET_SCREEN"; screen: "picker" | "workspace" }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "SET_ABOUT_OPEN"; open: boolean }
  | { type: "SET_HELP_OPEN"; open: boolean }
  | { type: "SET_THEME"; theme: ThemePreference }
  | { type: "SET_UI"; ui: Partial<UIState> }
  | { type: "SET_RESOLUTION_INCREASE"; value: ResolutionIncreaseState };

export const DEFAULT_UI: UIState = {
  ontologyPanelWidth: 260,
  designPartnerPanelWidth: 400,
  fontSize: 16,
};

const initialState: AppState = {
  screen: "picker",
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
  resolutionIncrease: "rest",
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, screen: action.screen };
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
    case "SET_RESOLUTION_INCREASE":
      return { ...state, resolutionIncrease: action.value };
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
