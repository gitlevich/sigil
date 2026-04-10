import { useEffect, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { Compartment } from "@codemirror/state";
import { getThemeExtension } from "../components/Workspace/sigilExtensions";

export function useThemeObserver(
  viewRef: RefObject<EditorView | null>,
  compartment: Compartment | RefObject<Compartment>,
) {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const view = viewRef.current;
      if (!view) return;
      const comp = "current" in compartment ? compartment.current : compartment;
      view.dispatch({ effects: comp.reconfigure(getThemeExtension()) });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
}
