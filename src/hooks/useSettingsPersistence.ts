import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppState, useAppDispatch, ThemePreference, UIState } from "../state/AppContext";
import { Settings, DEFAULT_KEYBINDINGS } from "../tauri";

const STORE_FILE = "settings.json";

interface PersistedDocState {
  rootPath: string;
  currentPath: string[];
  leftPanelOpen: boolean;
  leftPanelTab: "vision" | "tree";
  rightPanelOpen: boolean;
  editorMode: "edit" | "split" | "preview";
  contentTab: "language" | "integrations";
  activeChatId: string;
  wordWrap: boolean;
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
        const ui = await store.get<UIState>("ui");
        if (ui) {
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
      prev.leftPanelOpen === doc.leftPanelOpen &&
      prev.leftPanelTab === doc.leftPanelTab &&
      prev.rightPanelOpen === doc.rightPanelOpen &&
      prev.editorMode === doc.editorMode &&
      prev.contentTab === doc.contentTab &&
      prev.activeChatId === doc.activeChatId &&
      prev.wordWrap === doc.wordWrap &&
      JSON.stringify(prev.currentPath) === JSON.stringify(doc.currentPath) &&
      prev.sigil.root_path === doc.sigil.root_path
    ) {
      return;
    }
    prevDoc.current = doc;

    (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set("doc_state", {
          rootPath: doc.sigil.root_path,
          currentPath: doc.currentPath,
          leftPanelOpen: doc.leftPanelOpen,
          leftPanelTab: doc.leftPanelTab,
          rightPanelOpen: doc.rightPanelOpen,
          editorMode: doc.editorMode,
          contentTab: doc.contentTab,
          activeChatId: doc.activeChatId,
          wordWrap: doc.wordWrap,
        } as PersistedDocState);
        await store.save();
      } catch (err) {
        console.error("Failed to save doc state:", err);
      }
    })();
  }, [state.document]);
}

export async function getPersistedDocState(): Promise<PersistedDocState | null> {
  try {
    const store = await load(STORE_FILE);
    return await store.get<PersistedDocState>("doc_state") || null;
  } catch {
    return null;
  }
}
