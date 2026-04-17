/**
 * WorkspaceContext — the .sigil directory where I work.
 *
 * Holds the Idea (the sigil hierarchy on disk),
 * current navigation path, navigation history, and provides
 * navigate/back/reload operations.
 *
 * All views sync to this context: OntologyTree, editor, Atlas, breadcrumb.
 */
import { createContext, useContext, useReducer, useCallback, useMemo, ReactNode, Dispatch } from "react";
import { Idea, SigilFolder, api } from "../tauri";
import { findContext } from "sigil-core";
import type { Sigil } from "sigil-core";

export interface FileConflict {
  path: string;
  /** Last-known-disk snapshot at the moment the conflict was detected. Common ancestor for the three-way merge. */
  base: string;
  diskContent: string;
  localContent: string;
  deleted: boolean;
  /** Number of hunks the three-way merge resolved automatically (only mine-changed or only theirs-changed). */
  mergedCount: number;
  /** Number of hunks where both sides diverged from base and I must decide. */
  conflictCount: number;
}

export interface WorkspaceState {
  spec: Idea;
  currentPath: string[];
  history: string[][];
  collapsedPaths: string[];
  /** When set, the editor should scroll to this line after navigation. Consumed once. */
  targetLine: number | null;
  conflict: FileConflict | null;
  /** Whether the merge view is currently open. Defaults to false so the user isn't yanked from flow. */
  mergeViewOpen: boolean;
}

export type WorkspaceAction =
  | { type: "NAVIGATE"; path: string[]; targetLine?: number }
  | { type: "CLEAR_TARGET_LINE" }
  | { type: "BACK" }
  | { type: "UPDATE_SPEC"; spec: Idea }
  | { type: "SET_COLLAPSED_PATHS"; paths: string[] }
  | { type: "TOGGLE_COLLAPSE"; pathKey: string }
  | { type: "SET_CONFLICT"; conflict: FileConflict }
  | { type: "RESOLVE_CONFLICT" }
  | { type: "OPEN_MERGE_VIEW" }
  | { type: "CLOSE_MERGE_VIEW" };

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "NAVIGATE": {
      const history = [...state.history, state.currentPath];
      return { ...state, currentPath: action.path, history, targetLine: action.targetLine ?? null };
    }
    case "CLEAR_TARGET_LINE":
      return { ...state, targetLine: null };
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
    case "SET_CONFLICT":
      return { ...state, conflict: action.conflict, mergeViewOpen: false };
    case "RESOLVE_CONFLICT":
      return { ...state, conflict: null, mergeViewOpen: false };
    case "OPEN_MERGE_VIEW":
      return state.conflict ? { ...state, mergeViewOpen: true } : state;
    case "CLOSE_MERGE_VIEW":
      return { ...state, mergeViewOpen: false };
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
  spec: Idea;
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
    targetLine: null,
    conflict: null,
    mergeViewOpen: false,
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

  const navigate = useCallback((path: string[], targetLine?: number) => {
    dispatch({ type: "NAVIGATE", path, targetLine });
  }, [dispatch]);

  const back = useCallback(() => {
    dispatch({ type: "BACK" });
  }, [dispatch]);

  const readSpec = useCallback(async () => {
    return api.readSigil(state.spec.rootPath);
  }, [state.spec.rootPath]);

  const reload = useCallback(async () => {
    const spec = await readSpec();
    dispatch({ type: "UPDATE_SPEC", spec });
    return spec;
  }, [readSpec, dispatch]);

  return useMemo(() => ({ navigate, back, reload, readSpec }), [navigate, back, reload, readSpec]);
}
