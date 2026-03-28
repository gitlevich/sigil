import { useEffect, useRef, useCallback } from "react";
import { events } from "../tauri";
import { useAppState } from "../state/AppContext";
import { useSpecTree } from "./useSpecTree";
import { isAutoSaveDirty } from "./useAutoSave";

export function useFileWatcher() {
  const state = useAppState();
  const { reload } = useSpecTree();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFsChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isAutoSaveDirty()) return;
      if (!state.document) return;
      reload(state.document.specTree.root_path).catch(console.error);
    }, 1000);
  }, [state.document, reload]);

  useEffect(() => {
    const unlisten = events.onFsChange(handleFsChange);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleFsChange]);
}
