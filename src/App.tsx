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
import { EditorShell } from "./components/Editor/EditorShell";
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
      if (initialRootPath) {
        // Opened from menu/URL — open that specific sigil
        await openDocument(initialRootPath).catch(console.error);
        return;
      }

      // No explicit path — restore last session
      const saved = await getPersistedDocState();
      if (saved?.rootPath) {
        try {
          await openDocument(saved.rootPath);
          // Restore the full UI state after the document loads
          const chatMessages = saved.activeChatId
            ? (await api.readChat(saved.rootPath, saved.activeChatId).catch(() => ({ messages: [] }))).messages
            : [];

          dispatch({
            type: "UPDATE_DOCUMENT",
            updates: {
              currentPath: saved.currentPath || [],
              leftPanelOpen: saved.leftPanelOpen,
              leftPanelTab: saved.leftPanelTab,
              rightPanelOpen: saved.rightPanelOpen,
              editorMode: saved.editorMode,
              contentTab: (saved.contentTab as string) === "entanglements" ? "integrations" : (saved.contentTab || "language"),
              activeChatId: saved.activeChatId || "",
              chatMessages,
              wordWrap: saved.wordWrap ?? false,
            },
          });
        } catch {
          // Sigil no longer exists — show picker
        }
      }
    })();
  }, [initialRootPath, openDocument, dispatch]);

  return (
    <>
      {state.screen === "picker" ? <DocumentPicker /> : <EditorShell />}
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
    </>
  );
}
