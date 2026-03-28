import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppState, useAppDispatch } from "../state/AppContext";

function applyThemeToDOM(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const preference = state.themePreference;

  const resolveAndApply = useCallback(async () => {
    if (preference === "light" || preference === "dark") {
      applyThemeToDOM(preference);
      return;
    }
    // System theme
    try {
      const theme = await getCurrentWindow().theme();
      applyThemeToDOM(theme === "light" ? "light" : "dark");
    } catch {
      applyThemeToDOM("dark");
    }
  }, [preference]);

  useEffect(() => {
    resolveAndApply();
  }, [resolveAndApply]);

  // Listen for system theme changes
  useEffect(() => {
    if (preference !== "system") return;

    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onThemeChanged(({ payload }) => {
        applyThemeToDOM(payload === "light" ? "light" : "dark");
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [preference]);

  const setTheme = useCallback(
    (pref: "light" | "dark" | "system") => {
      dispatch({ type: "SET_THEME", theme: pref });
    },
    [dispatch]
  );

  return { themePreference: preference, setTheme };
}
