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
          // Migrate old flat format to profiles format
          if (!Array.isArray(raw.profiles)) {
            const oldProvider = (raw.provider as string) || "anthropic";
            const oldKey = (raw.api_key as string) || "";
            const oldModel = (raw.model as string) || "";
            const oldPrompt = (raw.system_prompt as string) || "";
            const migrated: Settings = {
              profiles: oldKey ? [{
                id: `migrated-${Date.now()}`,
                name: oldProvider === "anthropic" ? "Claude" : "ChatGPT",
                provider: oldProvider as "anthropic" | "openai",
                api_key: oldKey,
                model: oldModel,
              }] : [],
              active_profile_id: oldKey ? `migrated-${Date.now()}` : "",
              system_prompt: oldPrompt,
              response_style: "default",
            };
            // Fix the id reference
            if (migrated.profiles.length > 0) {
              migrated.active_profile_id = migrated.profiles[0].id;
            }
            dispatch({ type: "SET_SETTINGS", settings: migrated });
            await store.set("ai_settings", migrated);
            await store.save();
          } else {
            const settings = raw as unknown as Settings;
            // Ensure new fields have defaults
            if (!settings.response_style) settings.response_style = "default";
            dispatch({ type: "SET_SETTINGS", settings });
          }
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
