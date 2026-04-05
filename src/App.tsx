import { useEffect, useRef, useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "./state/AppContext";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { NarratingProvider, DEFAULT_NARRATING_STATE, NarratingState } from "./state/NarratingContext";
import { ConversingProvider, ConversingState } from "./state/ConversingContext";
import { useTheme } from "./hooks/useTheme";
import { useSettingsPersistence, getPersistedDocState } from "./hooks/useSettingsPersistence";
import { useUpdater } from "./hooks/useUpdater";
import { useFontZoom } from "./hooks/useFontZoom";
import { useSelectAll } from "./hooks/useSelectAll";
import { useSigil } from "./hooks/useSigil";
import { api, ApplicationSpec } from "./tauri";
import { DocumentPicker } from "./components/DocumentPicker/DocumentPicker";
import { WorkspaceShell } from "./WorkspaceShell";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { AboutDialog } from "./components/About/AboutDialog";
import { HelpDialog } from "./components/Help/HelpDialog";

interface AppProps {
  initialRootPath: string | null;
}

interface OpenedWorkspace {
  spec: ApplicationSpec;
  initialPath: string[];
  initialCollapsed: string[];
  initialNarrating: Partial<NarratingState>;
  initialConversing: Partial<ConversingState>;
}

export function App({ initialRootPath }: AppProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { openDocument } = useSigil();
  const opened = useRef(false);
  const [workspace, setWorkspace] = useState<OpenedWorkspace | null>(null);

  useTheme();
  useSettingsPersistence();
  useUpdater();
  useFontZoom();
  useSelectAll();

  const handleOpen = useCallback(async (rootPath: string, overrides: Record<string, unknown> = {}) => {
    const spec = await openDocument(rootPath);
    setWorkspace({
      spec,
      initialPath: (overrides.currentPath as string[]) ?? [],
      initialCollapsed: (overrides.collapsedPaths as string[]) ?? [],
      initialNarrating: {
        editorMode: (overrides.editorMode as NarratingState["editorMode"]) ?? DEFAULT_NARRATING_STATE.editorMode,
        contentTab: (overrides.contentTab as NarratingState["contentTab"]) ?? DEFAULT_NARRATING_STATE.contentTab,
        wordWrap: (overrides.wordWrap as boolean) ?? DEFAULT_NARRATING_STATE.wordWrap,
        ontologyPanelOpen: (overrides.ontologyPanelOpen as boolean) ?? DEFAULT_NARRATING_STATE.ontologyPanelOpen,
        ontologyPanelTab: (overrides.ontologyPanelTab as NarratingState["ontologyPanelTab"]) ?? DEFAULT_NARRATING_STATE.ontologyPanelTab,
        designPartnerPanelOpen: (overrides.designPartnerPanelOpen as boolean) ?? DEFAULT_NARRATING_STATE.designPartnerPanelOpen,
        designPartnerPanelTab: (overrides.designPartnerPanelTab as NarratingState["designPartnerPanelTab"]) ?? DEFAULT_NARRATING_STATE.designPartnerPanelTab,
      },
      initialConversing: {
        activeChatId: (overrides.activeChatId as string) ?? "",
        chatMessages: (overrides.chatMessages as []) ?? [],
      },
    });
    dispatch({ type: "SET_SCREEN", screen: "workspace" });
  }, [openDocument, dispatch]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    (async () => {
      await api.pruneRecentDocuments().catch(console.error);

      const pendingPath = await api.takePendingOpenPath().catch(() => null);
      const startPath = initialRootPath || pendingPath;

      const buildOverrides = (saved: Awaited<ReturnType<typeof getPersistedDocState>>) => {
        if (!saved) return {};
        return {
          currentPath: saved.currentPath || [],
          ontologyPanelOpen: saved.ontologyPanelOpen,
          ontologyPanelTab: (saved.ontologyPanelTab === "ontology" ? "ontology" : "vision") as "ontology" | "vision",
          designPartnerPanelOpen: saved.designPartnerPanelOpen,
          designPartnerPanelTab: (saved.designPartnerPanelTab === "memories" ? "memories" : "chat") as "memories" | "chat",
          editorMode: saved.editorMode,
          contentTab: ((saved.contentTab as string) === "map") ? "atlas" : (saved.contentTab || "language"),
          wordWrap: saved.wordWrap ?? false,
          collapsedPaths: saved.collapsedPaths ?? [],
        };
      };

      if (startPath) {
        try {
          const saved = await getPersistedDocState(startPath);
          await handleOpen(startPath, buildOverrides(saved));
        } catch {
          // stay on picker
        }
        return;
      }

      const saved = await getPersistedDocState();
      if (saved?.rootPath) {
        try {
          const chatMessages = saved.activeChatId
            ? (await api.readChat(saved.rootPath, saved.activeChatId).catch(() => ({ messages: [] }))).messages
            : [];

          await handleOpen(saved.rootPath, {
            ...buildOverrides(saved),
            activeChatId: saved.activeChatId ?? "",
            chatMessages,
          });
        } catch {
          // stay on picker
        }
      }
    })();
  }, [initialRootPath, handleOpen]);

  return (
    <>
      {state.screen === "picker" || !workspace ? (
        <DocumentPicker />
      ) : (
        <WorkspaceProvider
          spec={workspace.spec}
          initialPath={workspace.initialPath}
          initialCollapsed={workspace.initialCollapsed}
        >
          <NarratingProvider initial={workspace.initialNarrating}>
            <ConversingProvider initial={workspace.initialConversing}>
              <WorkspaceShell />
            </ConversingProvider>
          </NarratingProvider>
        </WorkspaceProvider>
      )}
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
    </>
  );
}
