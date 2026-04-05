import { useEffect, useRef, useCallback } from "react";
import { events } from "../tauri";
import { isAutoSaveDirty } from "./useAutoSave";

export function useFileWatcher(rootPath: string, reload: (rootPath: string) => Promise<unknown>, onError?: () => void) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFsChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isAutoSaveDirty()) return;
      reload(rootPath).catch(() => {
        onError?.();
      });
    }, 1000);
  }, [rootPath, reload, onError]);

  useEffect(() => {
    const unlisten = events.onFsChange(handleFsChange);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleFsChange]);
}
