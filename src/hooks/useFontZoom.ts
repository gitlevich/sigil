import { useEffect } from "react";
import { useAppState, useAppDispatch } from "../state/AppContext";

const MIN_FONT = 12;
const MAX_FONT = 24;
const STEP = 1;

export function useFontZoom() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fontSize = state.ui.fontSize || 16;

  // Apply font size as a CSS custom property for content areas only
  useEffect(() => {
    document.documentElement.style.setProperty("--content-font-size", `${fontSize}px`);
  }, [fontSize]);

  // Listen for Cmd+/Cmd- keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const next = Math.min(MAX_FONT, fontSize + STEP);
        dispatch({ type: "SET_UI", ui: { fontSize: next } });
      } else if (e.key === "-") {
        e.preventDefault();
        const next = Math.max(MIN_FONT, fontSize - STEP);
        dispatch({ type: "SET_UI", ui: { fontSize: next } });
      } else if (e.key === "0") {
        e.preventDefault();
        dispatch({ type: "SET_UI", ui: { fontSize: 16 } });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fontSize, dispatch]);
}
