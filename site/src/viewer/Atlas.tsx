import type { Context } from "./types";
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext, buildPath } from "./utils";
import { Atlas as AtlasBase } from "sigil-core/react/Atlas";

export function Atlas() {
  const { sigil, currentPath, theme } = useViewerState();
  const dispatch = useViewerDispatch();

  const currentCtx = findContext(sigil.root, currentPath);

  const handleNavigate = (ctx: Context) => {
    const path = buildPath(sigil.root, ctx.name, []);
    if (path) {
      dispatch({ type: "NAVIGATE", path });
    }
  };

  const handleEscape = currentPath.length > 1
    ? () => dispatch({ type: "NAVIGATE", path: currentPath.slice(0, -1) })
    : undefined;

  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const instructions = isTouch
    ? "Double-tap to open a sigil."
    : "Double-click to open a sigil.";

  return (
    <AtlasBase
      children={currentCtx.children}
      dark={theme === "dark"}
      onNavigate={handleNavigate}
      onEscape={handleEscape}
      revealedStorageKey="sigil-viewer-atlas-revealed"
      instructions={instructions}
    />
  );
}
