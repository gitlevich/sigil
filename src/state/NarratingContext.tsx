/**
 * NarratingContext — how I narrate what my application does.
 *
 * Language is foreground (editor mode, word wrap).
 * Content tab switches between Language (narrating) and Atlas (navigating).
 * Panel visibility for OntologyTree and VisionPanel.
 */
import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";

export interface NarratingState {
  editorMode: "edit" | "split" | "preview";
  contentTab: "language" | "atlas";
  wordWrap: boolean;
  ontologyPanelOpen: boolean;
  ontologyPanelTab: "vision" | "ontology";
  designPartnerPanelOpen: boolean;
  designPartnerPanelTab: "chat" | "memories";
}

type NarratingAction =
  | { type: "SET_EDITOR_MODE"; mode: "edit" | "split" | "preview" }
  | { type: "SET_CONTENT_TAB"; tab: "language" | "atlas" }
  | { type: "SET_WORD_WRAP"; wrap: boolean }
  | { type: "SET_ONTOLOGY_PANEL"; open: boolean; tab?: "vision" | "ontology" }
  | { type: "SET_DESIGN_PARTNER_PANEL"; open: boolean; tab?: "chat" | "memories" };

function reducer(state: NarratingState, action: NarratingAction): NarratingState {
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

export const DEFAULT_NARRATING_STATE: NarratingState = {
  editorMode: "split",
  contentTab: "language",
  wordWrap: false,
  ontologyPanelOpen: true,
  ontologyPanelTab: "ontology",
  designPartnerPanelOpen: false,
  designPartnerPanelTab: "chat",
};

const NarratingStateContext = createContext<NarratingState>(DEFAULT_NARRATING_STATE);
const NarratingDispatchContext = createContext<Dispatch<NarratingAction>>(() => {});

export function NarratingProvider({ initial, children }: { initial?: Partial<NarratingState>; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_NARRATING_STATE, ...initial });

  return (
    <NarratingStateContext.Provider value={state}>
      <NarratingDispatchContext.Provider value={dispatch}>
        {children}
      </NarratingDispatchContext.Provider>
    </NarratingStateContext.Provider>
  );
}

export function useNarratingState() {
  return useContext(NarratingStateContext);
}

export function useNarratingDispatch() {
  return useContext(NarratingDispatchContext);
}
