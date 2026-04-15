/**
 * LayoutContext — how I narrate what my application does.
 *
 * Language is foreground (editor mode, word wrap).
 * Content tab switches between Language and Atlas.
 * Panel visibility for OntologyTree and VisionPanel.
 */
import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";

export interface LayoutState {
  editorMode: "edit" | "split" | "preview";
  contentTab: "language" | "atlas";
  wordWrap: boolean;
  ontologyPanelOpen: boolean;
  ontologyPanelTab: "vision" | "ontology";
  designPartnerPanelOpen: boolean;
  designPartnerPanelTab: "chat" | "memories" | "experience";
}

type LayoutAction =
  | { type: "SET_EDITOR_MODE"; mode: "edit" | "split" | "preview" }
  | { type: "SET_CONTENT_TAB"; tab: "language" | "atlas" }
  | { type: "SET_WORD_WRAP"; wrap: boolean }
  | { type: "SET_ONTOLOGY_PANEL"; open: boolean; tab?: "vision" | "ontology" }
  | { type: "SET_DESIGN_PARTNER_PANEL"; open: boolean; tab?: "chat" | "memories" | "experience" };

function reducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case "SET_EDITOR_MODE":
      return { ...state, editorMode: action.mode };
    case "SET_CONTENT_TAB":
      return { ...state, contentTab: action.tab };
    case "SET_WORD_WRAP":
      return { ...state, wordWrap: action.wrap };
    case "SET_ONTOLOGY_PANEL":
      return {
        ...state,
        ontologyPanelOpen: action.open,
        ...(action.tab ? { ontologyPanelTab: action.tab } : {}),
      };
    case "SET_DESIGN_PARTNER_PANEL":
      return {
        ...state,
        designPartnerPanelOpen: action.open,
        ...(action.tab ? { designPartnerPanelTab: action.tab } : {}),
      };
  }
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  editorMode: "split",
  contentTab: "language",
  wordWrap: false,
  ontologyPanelOpen: true,
  ontologyPanelTab: "ontology",
  designPartnerPanelOpen: false,
  designPartnerPanelTab: "chat",
};

const LayoutStateContext = createContext<LayoutState>(DEFAULT_LAYOUT_STATE);
const LayoutDispatchContext = createContext<Dispatch<LayoutAction>>(() => {});

export function LayoutProvider({ initial, children }: { initial?: Partial<LayoutState>; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_LAYOUT_STATE, ...initial });

  return (
    <LayoutStateContext.Provider value={state}>
      <LayoutDispatchContext.Provider value={dispatch}>
        {children}
      </LayoutDispatchContext.Provider>
    </LayoutStateContext.Provider>
  );
}

export function useLayoutState() {
  return useContext(LayoutStateContext);
}

export function useLayoutDispatch() {
  return useContext(LayoutDispatchContext);
}
