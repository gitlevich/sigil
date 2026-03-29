import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppState, useAppDispatch, ThemePreference, UIState } from "../state/AppContext";
import { Settings } from "../tauri";

const STORE_FILE = "settings.json";

interface PersistedDocState {
  leftPanelOpen: boolean;
  leftPanelTab: "vision" | "tree";
  rightPanelOpen: boolean;
  editorMode: "edit" | "split" | "preview";
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

          if (Array.isArray(r.attention_providers)) {
            // Current format
            settings = r as unknown as Settings;
          } else if (Array.isArray(r.profiles)) {
            // Previous profiles format -> attention_providers
            const oldProfiles = r.profiles as Array<Record<string, unknown>>;
            settings = {
              attention_providers: oldProfiles.map((p) => ({
                id: (p.id as string) || `migrated-${Date.now()}`,
                name: (p.name as string) || "Unknown",
                provider: (p.provider as "anthropic" | "openai") || "anthropic",
                api_key: (p.api_key as string) || "",
                model: (p.model as string) || "",
                enabled: true,
              })),
              selected_provider_id: (r.active_profile_id as string) || "",
              system_prompt: (r.system_prompt as string) || "",
              response_style: (r.response_style as Settings["response_style"]) || "default",
            };
          } else {
            // Oldest flat format
            const oldProvider = (r.provider as string) || "anthropic";
            const oldKey = (r.api_key as string) || "";
            const oldModel = (r.model as string) || "";
            const id = `migrated-${Date.now()}`;
            settings = {
              attention_providers: oldKey ? [{
                id,
                name: oldProvider === "anthropic" ? "Claude" : "ChatGPT",
                provider: oldProvider as "anthropic" | "openai",
                api_key: oldKey,
                model: oldModel,
                enabled: true,
              }] : [],
              selected_provider_id: oldKey ? id : "",
              system_prompt: (r.system_prompt as string) || "",
              response_style: "default",
            };
          }

          // Ensure defaults for new fields
          if (!settings.response_style) settings.response_style = "default";
          if (!settings.attention_providers) settings.attention_providers = [];
          // Ensure all providers have the enabled field
          settings.attention_providers = settings.attention_providers.map((p) => ({
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
        const docState = await store.get<PersistedDocState>("doc_state");
        if (docState) {
          dispatch({ type: "UPDATE_DOCUMENT", updates: docState });
        }
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

    // Only save if relevant fields changed
    const prev = prevDoc.current;
    if (
      prev &&
      prev.leftPanelOpen === doc.leftPanelOpen &&
      prev.leftPanelTab === doc.leftPanelTab &&
      prev.rightPanelOpen === doc.rightPanelOpen &&
      prev.editorMode === doc.editorMode
    ) {
      return;
    }
    prevDoc.current = doc;

    (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set("doc_state", {
          leftPanelOpen: doc.leftPanelOpen,
          leftPanelTab: doc.leftPanelTab,
          rightPanelOpen: doc.rightPanelOpen,
          editorMode: doc.editorMode,
        });
        await store.save();
      } catch (err) {
        console.error("Failed to save doc state:", err);
      }
    })();
  }, [state.document]);
}
