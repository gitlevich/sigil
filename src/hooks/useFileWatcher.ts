import { useEffect, useRef, useCallback } from "react";
import { events, FsChangeEvent } from "../tauri";

export function useFileWatcher(
  rootPath: string,
  reload: (rootPath: string, event: FsChangeEvent) => Promise<unknown>,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventRef = useRef<FsChangeEvent | null>(null);

  // Use a ref so the debounce timer always calls the latest reload,
  // even if the component re-rendered since the timer was started.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const handleFsChange = useCallback((event: FsChangeEvent) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingEventRef.current = event;
    debounceRef.current = setTimeout(() => {
      const ev = pendingEventRef.current;
      pendingEventRef.current = null;
      if (!ev) return;
      reloadRef.current(rootPath, ev).catch(() => {});
    }, 1000);
  }, [rootPath]);

  useEffect(() => {
    const unlisten = events.onFsChange(handleFsChange);
    return () => {
      // Cancel pending debounce so stale timers never fire after re-subscription
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      unlisten.then((fn) => fn());
    };
  }, [handleFsChange]);
}
