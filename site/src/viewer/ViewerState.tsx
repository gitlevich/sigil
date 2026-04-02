import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { Sigil } from "./types";

export type ContentTab = "language" | "atlas";
export type SidebarTab = "tree" | "vision";
export type Theme = "light" | "dark";

interface ViewerState {
  sigil: Sigil;
  currentPath: string[];
  contentTab: ContentTab;
  sidebarTab: SidebarTab;
  theme: Theme;
}

type Action =
  | { type: "NAVIGATE"; path: string[] }
  | { type: "SET_TAB"; tab: ContentTab }
  | { type: "SET_SIDEBAR_TAB"; tab: SidebarTab }
  | { type: "SET_THEME"; theme: Theme };

function reducer(state: ViewerState, action: Action): ViewerState {
  switch (action.type) {
    case "NAVIGATE":
      return { ...state, currentPath: action.path };
    case "SET_TAB":
      return { ...state, contentTab: action.tab };
    case "SET_SIDEBAR_TAB":
      return { ...state, sidebarTab: action.tab };
    case "SET_THEME":
      return { ...state, theme: action.theme };
  }
}

const StateContext = createContext<ViewerState | null>(null);
const DispatchContext = createContext<React.Dispatch<Action>>(() => {});

export function ViewerProvider({
  sigil,
  children,
}: {
  sigil: Sigil;
  children: ReactNode;
}) {
  const initialTheme: Theme =
    (localStorage.getItem("sigil-viewer-theme") as Theme) ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");

  const [state, dispatch] = useReducer(reducer, {
    sigil,
    currentPath: sigil.root.children.length > 0 ? [sigil.root.children[0].name] : [],
    contentTab: "language",
    sidebarTab: "tree",
    theme: initialTheme,
  });

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useViewerState() {
  const state = useContext(StateContext);
  if (!state) throw new Error("useViewerState must be used within ViewerProvider");
  return state;
}

export function useViewerDispatch() {
  return useContext(DispatchContext);
}
