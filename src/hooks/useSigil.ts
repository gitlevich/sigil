import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, IdeaSpec } from "../tauri";

export function useSigil() {
  const reload = useCallback(async (rootPath: string): Promise<IdeaSpec> => {
    return api.readSigil(rootPath);
  }, []);

  const openDocument = useCallback(async (rootPath: string): Promise<IdeaSpec> => {
    const spec = await api.readSigil(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);
    await getCurrentWindow().setTitle(spec.name).catch(() => {});
    return spec;
  }, []);

  return { reload, openDocument };
}
