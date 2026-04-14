import { useEffect, useRef, useCallback } from "react";
import { events, FsChangeEvent } from "../tauri";

export function useFileWatcher(
  rootPath: string,
  reload: (rootPath: string, event: FsChangeEvent) => Promise<unknown>,
  onError?: () => void,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventRef = useRef<FsChangeEvent | null>(null);

  const handleFsChange = useCallback((event: FsChangeEvent) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingEventRef.current = event;
    debounceRef.current = setTimeout(() => {
      const ev = pendingEventRef.current;
      pendingEventRef.current = null;
      if (!ev) return;
      reload(rootPath, ev).catch(() => {
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
