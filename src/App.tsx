import { useEffect, useRef } from "react";
import { useAppState, useAppDispatch } from "./state/AppContext";
import { useTheme } from "./hooks/useTheme";
import { useSettingsPersistence, getPersistedDocState } from "./hooks/useSettingsPersistence";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useAppMenu } from "./hooks/useAppMenu";
import { useUpdater } from "./hooks/useUpdater";
import { useFontZoom } from "./hooks/useFontZoom";
import { useSelectAll } from "./hooks/useSelectAll";
import { useSigil } from "./hooks/useSigil";
import { api } from "./tauri";
import { DocumentPicker } from "./components/DocumentPicker/DocumentPicker";
import { Workspace } from "./components/Workspace/Workspace";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { AboutDialog } from "./components/About/AboutDialog";
import { HelpDialog } from "./components/Help/HelpDialog";

interface AppProps {
  initialRootPath: string | null;
}

export function App({ initialRootPath }: AppProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { openDocument } = useSigil();
  const opened = useRef(false);

  useTheme();
  useSettingsPersistence();
  useFileWatcher();
  useAppMenu();
  useUpdater();
  useFontZoom();
  useSelectAll();

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    (async () => {
      // Clean up stale recent documents before anything else
      await api.pruneRecentDocuments().catch(console.error);

      // Check for path from Finder double-click (arrived before frontend was ready)
      const pendingPath = await api.takePendingOpenPath().catch(() => null);
      const startPath = initialRootPath || pendingPath;

      if (startPath) {
        try {
          await openDocument(startPath);
        } catch {
          dispatch({ type: "CLEAR_DOCUMENT" });
        }
        return;
      }

      // No explicit path — restore last session
      const saved = await getPersistedDocState();
      if (saved?.rootPath) {
        try {
          const chatMessages = saved.activeChatId
            ? (await api.readChat(saved.rootPath, saved.activeChatId).catch(() => ({ messages: [] }))).messages
            : [];

          await openDocument(saved.rootPath, {
            currentPath: saved.currentPath || [],
            ontologyPanelOpen: saved.ontologyPanelOpen,
            ontologyPanelTab: saved.ontologyPanelTab === "ontology" ? "ontology" : "vision",
            designPartnerPanelOpen: saved.designPartnerPanelOpen,
            designPartnerPanelTab: saved.designPartnerPanelTab === "memories" ? "memories" : "chat",
            editorMode: saved.editorMode,
            contentTab: ((saved.contentTab as string) === "map") ? "atlas" : (saved.contentTab || "language"),
            activeChatId: saved.activeChatId ?? "",
            chatMessages,
            wordWrap: saved.wordWrap ?? false,
            collapsedPaths: saved.collapsedPaths ?? [],
          });
        } catch {
          // Sigil no longer exists — stay on picker
          dispatch({ type: "CLEAR_DOCUMENT" });
        }
      }
    })();
  }, [initialRootPath, openDocument, dispatch]);

  return (
    <>
      {state.screen === "picker" ? <DocumentPicker /> : <Workspace />}
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
    </>
  );
}
