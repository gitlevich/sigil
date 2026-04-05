/**
 * WorkspaceContext — the .sigil directory where I work.
 *
 * Holds the ApplicationSpec (the sigil hierarchy on disk),
 * current navigation path, navigation history, and provides
 * navigate/back/reload operations.
 *
 * All views sync to this context: OntologyTree, editor, Atlas, breadcrumb.
 */
import { createContext, useContext, useReducer, useCallback, useMemo, ReactNode, Dispatch } from "react";
import { ApplicationSpec, SigilFolder, api } from "../tauri";
import { findContext } from "sigil-core";
import type { Sigil } from "sigil-core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WorkspaceState {
  spec: ApplicationSpec;
  currentPath: string[];
  history: string[][];
  collapsedPaths: string[];
}

type WorkspaceAction =
  | { type: "NAVIGATE"; path: string[] }
  | { type: "BACK" }
  | { type: "UPDATE_SPEC"; spec: ApplicationSpec }
  | { type: "SET_COLLAPSED_PATHS"; paths: string[] }
  | { type: "TOGGLE_COLLAPSE"; pathKey: string };

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "NAVIGATE": {
      const history = [...state.history, state.currentPath];
      return { ...state, currentPath: action.path, history };
    }
    case "BACK": {
      if (state.history.length === 0) return state;
      const history = state.history.slice(0, -1);
      const currentPath = state.history[state.history.length - 1];
      return { ...state, currentPath, history };
    }
    case "UPDATE_SPEC":
      return { ...state, spec: action.spec };
    case "SET_COLLAPSED_PATHS":
      return { ...state, collapsedPaths: action.paths };
    case "TOGGLE_COLLAPSE": {
      const has = state.collapsedPaths.includes(action.pathKey);
      const paths = has
        ? state.collapsedPaths.filter((p) => p !== action.pathKey)
        : [...state.collapsedPaths, action.pathKey];
      return { ...state, collapsedPaths: paths };
    }
  }
}

// ── Derived values ──

/** Resolve the current SigilFolder, routing imported ontology paths correctly. */
export function resolveCurrentFolder(state: WorkspaceState): SigilFolder | null {
  const { spec, currentPath } = state;
  const isImported = currentPath[0] === "Imported Ontologies" && spec.importedOntologies;
  const root = isImported ? spec.importedOntologies! : spec.root;
  const path = isImported ? currentPath.slice(1) : currentPath;
  const result = findContext(root as Sigil, path);
  // findContext returns the last valid node if path is invalid — check if we reached the target
  if (path.length > 0 && result.name !== path[path.length - 1]) return null;
  return result as SigilFolder;
}

/** Get the scope root and scope-relative path for the current navigation. */
export function scopeInfo(state: WorkspaceState): { scopeRoot: SigilFolder; scopePath: string[] } {
  const { spec, currentPath } = state;
  const isImported = currentPath[0] === "Imported Ontologies" && spec.importedOntologies;
  return {
    scopeRoot: (isImported ? spec.importedOntologies! : spec.root),
    scopePath: isImported ? currentPath.slice(1) : currentPath,
  };
}

export function isImportedPath(state: WorkspaceState): boolean {
  return state.currentPath[0] === "Imported Ontologies" && !!state.spec.importedOntologies;
}

// ── Context ──

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);
const WorkspaceDispatchContext = createContext<Dispatch<WorkspaceAction>>(() => {});

interface WorkspaceProviderProps {
  spec: ApplicationSpec;
  initialPath?: string[];
  initialCollapsed?: string[];
  children: ReactNode;
}

export function WorkspaceProvider({ spec, initialPath = [], initialCollapsed = [], children }: WorkspaceProviderProps) {
  const [state, dispatch] = useReducer(reducer, {
    spec,
    currentPath: initialPath,
    history: [],
    collapsedPaths: initialCollapsed,
  });

  return (
    <WorkspaceStateContext.Provider value={state}>
      <WorkspaceDispatchContext.Provider value={dispatch}>
        {children}
      </WorkspaceDispatchContext.Provider>
    </WorkspaceStateContext.Provider>
  );
}

export function useWorkspaceState(): WorkspaceState {
  const state = useContext(WorkspaceStateContext);
  if (!state) throw new Error("useWorkspaceState must be used within WorkspaceProvider");
  return state;
}

export function useWorkspaceDispatch() {
  return useContext(WorkspaceDispatchContext);
}

/** Convenience: navigate, back, reload operations. */
export function useWorkspaceActions() {
  const dispatch = useWorkspaceDispatch();
  const state = useWorkspaceState();

  const navigate = useCallback((path: string[]) => {
    dispatch({ type: "NAVIGATE", path });
  }, [dispatch]);

  const back = useCallback(() => {
    dispatch({ type: "BACK" });
  }, [dispatch]);

  const reload = useCallback(async () => {
    const spec = await api.readSigil(state.spec.rootPath);
    dispatch({ type: "UPDATE_SPEC", spec });
    return spec;
  }, [state.spec.rootPath, dispatch]);

  return useMemo(() => ({ navigate, back, reload }), [navigate, back, reload]);
}
