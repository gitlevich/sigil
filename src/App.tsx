import { useEffect, useRef, useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "./state/AppContext";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { LayoutProvider, DEFAULT_LAYOUT_STATE, LayoutState } from "./state/LayoutContext";
import { ChatProvider, ChatState } from "./state/ChatContext";
import { useTheme } from "./hooks/useTheme";
import { useSettingsPersistence, getPersistedDocState } from "./hooks/useSettingsPersistence";
import { useUpdater } from "./hooks/useUpdater";
import { useFontZoom } from "./hooks/useFontZoom";
import { useSelectAll } from "./hooks/useSelectAll";
import { useSigil } from "./hooks/useSigil";
import { useResolutionIncrease } from "./hooks/useResolutionIncrease";
import { api, Idea } from "./tauri";
import { useAppMenu, type MenuWorkspaceRef } from "./hooks/useAppMenu";
import { DocumentPicker } from "./components/DocumentPicker/DocumentPicker";
import { WorkspaceShell } from "./WorkspaceShell";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { AboutDialog } from "./components/About/AboutDialog";
import { HelpDialog } from "./components/Help/HelpDialog";

interface AppProps {
  initialRootPath: string | null;
}

interface OpenedWorkspace {
  spec: Idea;
  initialPath: string[];
  initialCollapsed: string[];
  initialLayout: Partial<LayoutState>;
  initialChat: Partial<ChatState>;
}

export function App({ initialRootPath }: AppProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { openDocument } = useSigil();
  const opened = useRef(false);
  const menuWorkspaceRef = useRef<MenuWorkspaceRef | null>(null);
  const [workspace, setWorkspace] = useState<OpenedWorkspace | null>(null);

  useAppMenu(menuWorkspaceRef);
  useTheme();
  useSettingsPersistence();
  useUpdater();
  useFontZoom();
  useSelectAll();
  useResolutionIncrease();

  const handleOpen = useCallback(async (rootPath: string, overrides: Record<string, unknown> = {}) => {
    const spec = await openDocument(rootPath);
    setWorkspace({
      spec,
      initialPath: (overrides.currentPath as string[]) ?? [],
      initialCollapsed: (overrides.collapsedPaths as string[]) ?? [],
      initialLayout: {
        editorMode: (overrides.editorMode as LayoutState["editorMode"]) ?? DEFAULT_LAYOUT_STATE.editorMode,
        contentTab: (overrides.contentTab as LayoutState["contentTab"]) ?? DEFAULT_LAYOUT_STATE.contentTab,
        wordWrap: (overrides.wordWrap as boolean) ?? DEFAULT_LAYOUT_STATE.wordWrap,
        ontologyPanelOpen: (overrides.ontologyPanelOpen as boolean) ?? DEFAULT_LAYOUT_STATE.ontologyPanelOpen,
        ontologyPanelTab: (overrides.ontologyPanelTab as LayoutState["ontologyPanelTab"]) ?? DEFAULT_LAYOUT_STATE.ontologyPanelTab,
        designPartnerPanelOpen: (overrides.designPartnerPanelOpen as boolean) ?? DEFAULT_LAYOUT_STATE.designPartnerPanelOpen,
        designPartnerPanelTab: (overrides.designPartnerPanelTab as LayoutState["designPartnerPanelTab"]) ?? DEFAULT_LAYOUT_STATE.designPartnerPanelTab,
      },
      initialChat: {
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
          activeChatId: saved.activeChatId ?? "",
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
        <DocumentPicker onOpen={handleOpen} />
      ) : (
        <WorkspaceProvider
          spec={workspace.spec}
          initialPath={workspace.initialPath}
          initialCollapsed={workspace.initialCollapsed}
        >
          <LayoutProvider initial={workspace.initialLayout}>
            <ChatProvider initial={workspace.initialChat}>
              <WorkspaceShell menuWorkspaceRef={menuWorkspaceRef} />
            </ChatProvider>
          </LayoutProvider>
        </WorkspaceProvider>
      )}
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
    </>
  );
}
