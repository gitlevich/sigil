import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppState, useAppDispatch, ThemePreference, UIState } from "../state/AppContext";
import { Settings, DEFAULT_KEYBINDINGS } from "../tauri";

const STORE_FILE = "settings.json";

interface PersistedDocState {
  rootPath: string;
  currentPath: string[];
  ontologyPanelOpen: boolean;
  ontologyPanelTab: "vision" | "ontology";
  designPartnerPanelOpen: boolean;
  designPartnerPanelTab: "chat" | "memories";
  editorMode: "edit" | "split" | "preview";
  contentTab: "language" | "atlas";
  activeChatId: string;
  wordWrap: boolean;
  collapsedPaths?: string[];
}

export function useSettingsPersistence() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const loaded = useRef(false);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const raw = await store.get<Record<string, unknown>>("ai_settings");
        if (raw) {
          // Migrate from any previous format to current
          const r = raw as Record<string, unknown>;
          let settings: Settings;

          if (Array.isArray(r.ai_providers)) {
            // Current format
            settings = r as unknown as Settings;
          } else if (Array.isArray(r.attention_providers)) {
            // Migrate from old attention_providers key -> ai_providers
            settings = { ...r, ai_providers: r.attention_providers } as unknown as Settings;
          } else if (Array.isArray(r.profiles)) {
            // Previous profiles format -> ai_providers
            const oldProfiles = r.profiles as Array<Record<string, unknown>>;
            settings = {
              ai_providers: oldProfiles.map((p) => ({
                id: (p.id as string) || `migrated-${Date.now()}`,
                name: (p.name as string) || "Unknown",
                provider: (p.provider as "anthropic" | "openai") || "anthropic",
                api_key: (p.api_key as string) || "",
                model: (p.model as string) || "",
                enabled: true,
              })),
              selected_provider_id: (r.active_profile_id as string) || "",
              system_prompt: (r.system_prompt as string) || "",
              response_style: "laconic" as Settings["response_style"],
              keybindings: DEFAULT_KEYBINDINGS,
            };
          } else {
            // Oldest flat format
            const oldProvider = (r.provider as string) || "anthropic";
            const oldKey = (r.api_key as string) || "";
            const oldModel = (r.model as string) || "";
            const id = `migrated-${Date.now()}`;
            settings = {
              ai_providers: oldKey ? [{
                id,
                name: oldProvider === "anthropic" ? "Claude" : "ChatGPT",
                provider: oldProvider as "anthropic" | "openai",
                api_key: oldKey,
                model: oldModel,
                enabled: true,
              }] : [],
              selected_provider_id: oldKey ? id : "",
              system_prompt: (r.system_prompt as string) || "",
              response_style: "laconic",
              keybindings: DEFAULT_KEYBINDINGS,
            };
          }

          // Ensure defaults for new fields
          if (!settings.response_style || (settings.response_style as string) === "default") settings.response_style = "laconic";
          if (!settings.ai_providers) settings.ai_providers = [];
          if (!settings.keybindings) settings.keybindings = DEFAULT_KEYBINDINGS;
          else settings.keybindings = { ...DEFAULT_KEYBINDINGS, ...settings.keybindings };
          // Ensure all providers have the enabled field
          settings.ai_providers = settings.ai_providers.map((p) => ({
            ...p,
            enabled: p.enabled !== undefined ? p.enabled : true,
          }));

          dispatch({ type: "SET_SETTINGS", settings });
          await store.set("ai_settings", settings);
          await store.save();
        }
        const theme = await store.get<ThemePreference>("theme");
        if (theme) {
          dispatch({ type: "SET_THEME", theme });
        }
        const uiRaw = await store.get<Record<string, unknown>>("ui");
        if (uiRaw) {
          const ui: Partial<UIState> = {
            ontologyPanelWidth: (uiRaw.ontologyPanelWidth ?? uiRaw.leftPanelWidth ?? 260) as number,
            designPartnerPanelWidth: (uiRaw.designPartnerPanelWidth ?? uiRaw.rightPanelWidth ?? 400) as number,
            fontSize: (uiRaw.fontSize ?? 16) as number,
          };
          dispatch({ type: "SET_UI", ui });
        }
        // Doc state is loaded by App.tsx via getPersistedDocState()
        loaded.current = true;
      } catch (err) {
        console.error("Failed to load settings:", err);
        loaded.current = true;
      }
    })();
  }, [dispatch]);

  // Save settings and theme
  const prevSettings = useRef(state.settings);
  const prevTheme = useRef(state.themePreference);

  useEffect(() => {
    if (!loaded.current) return;
    if (
      prevSettings.current === state.settings &&
      prevTheme.current === state.themePreference
    ) {
      return;
    }
    prevSettings.current = state.settings;
    prevTheme.current = state.themePreference;

    (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set("ai_settings", state.settings);
        await store.set("theme", state.themePreference);
        await store.save();
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    })();
  }, [state.settings, state.themePreference]);

  // Save UI state (panel widths)
  const prevUI = useRef(state.ui);

  useEffect(() => {
    if (!loaded.current) return;
    if (prevUI.current === state.ui) return;
    prevUI.current = state.ui;

    (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set("ui", state.ui);
        await store.save();
      } catch (err) {
        console.error("Failed to save UI state:", err);
      }
    })();
  }, [state.ui]);

  // Save document UI state (panel open/closed, editor mode, active tab)
  const prevDoc = useRef(state.document);

  useEffect(() => {
    if (!loaded.current) return;
    if (!state.document) return;
    const doc = state.document;

    const prev = prevDoc.current;
    if (
      prev &&
      prev.ontologyPanelOpen === doc.ontologyPanelOpen &&
      prev.ontologyPanelTab === doc.ontologyPanelTab &&
      prev.designPartnerPanelOpen === doc.designPartnerPanelOpen &&
      prev.designPartnerPanelTab === doc.designPartnerPanelTab &&
      prev.editorMode === doc.editorMode &&
      prev.contentTab === doc.contentTab &&
      prev.activeChatId === doc.activeChatId &&
      prev.wordWrap === doc.wordWrap &&
      JSON.stringify(prev.currentPath) === JSON.stringify(doc.currentPath) &&
      JSON.stringify(prev.collapsedPaths) === JSON.stringify(doc.collapsedPaths) &&
      prev.sigil.root_path === doc.sigil.root_path
    ) {
      return;
    }
    prevDoc.current = doc;

    const rootPath = doc.sigil.root_path;
    const stateToSave: PersistedDocState = {
      rootPath,
      currentPath: doc.currentPath,
      ontologyPanelOpen: doc.ontologyPanelOpen,
      ontologyPanelTab: doc.ontologyPanelTab,
      designPartnerPanelOpen: doc.designPartnerPanelOpen,
      designPartnerPanelTab: doc.designPartnerPanelTab,
      editorMode: doc.editorMode,
      contentTab: doc.contentTab,
      activeChatId: doc.activeChatId,
      wordWrap: doc.wordWrap,
      collapsedPaths: doc.collapsedPaths,
    };
    (async () => {
      try {
        const store = await load(STORE_FILE);
        // Persist per-workspace so multiple windows don't clobber each other
        const allStates = await store.get<Record<string, PersistedDocState>>("doc_states") ?? {};
        allStates[rootPath] = stateToSave;
        await store.set("doc_states", allStates);
        // Track the most recently active workspace for session resume
        await store.set("last_active_root", rootPath);
        // Migrate: remove old singleton key
        await store.delete("doc_state");
        await store.save();
      } catch (err) {
        console.error("Failed to save doc state:", err);
      }
    })();
  }, [state.document]);
}

export async function getPersistedDocState(forRootPath?: string): Promise<PersistedDocState | null> {
  try {
    const store = await load(STORE_FILE);

    // Try new per-workspace store first
    const allStates = await store.get<Record<string, PersistedDocState>>("doc_states");
    if (allStates) {
      const lookupPath = forRootPath || (await store.get<string>("last_active_root"));
      if (lookupPath && allStates[lookupPath]) {
        return allStates[lookupPath];
      }
    }

    // Fall back to old singleton for migration
    const raw = await store.get<Record<string, unknown>>("doc_state");
    if (!raw) return null;
    return {
      rootPath: (raw.rootPath as string) ?? "",
      currentPath: (raw.currentPath as string[]) ?? [],
      ontologyPanelOpen: (raw.ontologyPanelOpen ?? raw.leftPanelOpen ?? true) as boolean,
      ontologyPanelTab: ((raw.ontologyPanelTab ?? raw.leftPanelTab ?? "ontology") as PersistedDocState["ontologyPanelTab"]),
      designPartnerPanelOpen: (raw.designPartnerPanelOpen ?? raw.rightPanelOpen ?? false) as boolean,
      designPartnerPanelTab: ((raw.designPartnerPanelTab ?? raw.rightPanelTab ?? "chat") as PersistedDocState["designPartnerPanelTab"]),
      editorMode: (raw.editorMode as PersistedDocState["editorMode"]) ?? "edit",
      contentTab: (raw.contentTab as PersistedDocState["contentTab"]) ?? "language",
      activeChatId: (raw.activeChatId as string) ?? "",
      wordWrap: (raw.wordWrap as boolean) ?? false,
      collapsedPaths: (raw.collapsedPaths as string[]) ?? [],
    };
  } catch {
    return null;
  }
}
