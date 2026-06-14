/**
 * SpatialDesktop (site wrapper) — feeds the shared sigil-core component the
 * read-only viewer's state and a localStorage-backed layout store, so a
 * hand-arranged desktop survives reloads. "Through" is omitted (editor-only).
 */
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext } from "./utils";
import { SpatialDesktop as SpatialDesktopView } from "sigil-core/react/SpatialDesktop";
import { browserLayoutStore } from "./persistence";

export function SpatialDesktop() {
  const { sigil, currentPath, theme } = useViewerState();
  const dispatch = useViewerDispatch();
  const folder = findContext(sigil, currentPath);

  return (
    <SpatialDesktopView
      folder={folder}
      currentPath={currentPath}
      rootName={sigil.name}
      mainRoot={sigil}
      importedRoot={null}
      navigate={(path) => dispatch({ type: "NAVIGATE", path })}
      layoutStore={browserLayoutStore}
      dark={theme === "dark"}
    />
  );
}
