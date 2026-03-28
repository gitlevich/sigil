import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppState, useAppDispatch, ThemePreference } from "../state/AppContext";
import { Settings } from "../tauri";

const STORE_FILE = "settings.json";

export function useSettingsPersistence() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const loaded = useRef(false);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const settings = await store.get<Settings>("ai_settings");
        if (settings) {
          dispatch({ type: "SET_SETTINGS", settings });
        }
        const theme = await store.get<ThemePreference>("theme");
        if (theme) {
          dispatch({ type: "SET_THEME", theme });
        }
        loaded.current = true;
      } catch (err) {
        console.error("Failed to load settings:", err);
        loaded.current = true;
      }
    })();
  }, [dispatch]);

  // Save when settings or theme change (skip the initial load)
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
}
