import { useEffect, useRef, useCallback } from "react";
import { events } from "../tauri";
import { useAppState, useAppDispatch } from "../state/AppContext";
import { useSigil } from "./useSigil";
import { isAutoSaveDirty } from "./useAutoSave";

export function useFileWatcher() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { reload } = useSigil();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFsChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isAutoSaveDirty()) return;
      if (!state.document) return;
      reload(state.document.sigil.root_path).catch(() => {
        // Sigil root moved or deleted — go back to picker
        dispatch({ type: "CLEAR_DOCUMENT" });
      });
    }, 1000);
  }, [state.document, reload, dispatch]);

  useEffect(() => {
    const unlisten = events.onFsChange(handleFsChange);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleFsChange]);
}
