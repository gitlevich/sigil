import { useEffect, useRef } from "react";
import { useAppState } from "./state/AppContext";
import { useTheme } from "./hooks/useTheme";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useAppMenu } from "./hooks/useAppMenu";
import { useSigil } from "./hooks/useSigil";
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
  const { openDocument } = useSigil();
  const opened = useRef(false);

  useTheme();
  useSettingsPersistence();
  useFileWatcher();
  useAppMenu();

  useEffect(() => {
    if (opened.current) return;
    if (initialRootPath) {
      opened.current = true;
      openDocument(initialRootPath).catch(console.error);
    }
  }, [initialRootPath, openDocument]);

  return (
    <>
      {state.screen === "picker" ? <DocumentPicker /> : <EditorShell />}
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
    </>
  );
}
