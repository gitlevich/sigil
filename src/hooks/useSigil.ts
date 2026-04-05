import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, ApplicationSpec } from "../tauri";

export function useSigil() {
  const reload = useCallback(async (rootPath: string): Promise<ApplicationSpec> => {
    return api.readSigil(rootPath);
  }, []);

  const openDocument = useCallback(async (rootPath: string): Promise<ApplicationSpec> => {
    const spec = await api.readSigil(rootPath);
    await api.addRecentDocument(rootPath);
    await api.watchDirectory(rootPath);
    await getCurrentWindow().setTitle(spec.name).catch(() => {});
    return spec;
  }, []);

  return { reload, openDocument };
}
