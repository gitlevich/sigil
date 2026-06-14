/**
 * SpatialDesktop (site wrapper) — feeds the shared sigil-core component the
 * read-only viewer's state. Layout comes from the spec exported with each
 * sigil's saved arrangement baked in; writes are no-ops, so dragging works
 * in-session but does not persist. "Through" is omitted (editor-only).
 */
import { useViewerState, useViewerDispatch } from "./ViewerState";
import { findContext } from "./utils";
import { emptyLayout } from "sigil-core/spatialLayout";
import type { Sigil } from "sigil-core";
import { SpatialDesktop as SpatialDesktopView } from "sigil-core/react/SpatialDesktop";

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
      readLayout={(f: Sigil) => Promise.resolve(f.spatialLayout ?? emptyLayout())}
      writeLayout={() => Promise.resolve()}
      dark={theme === "dark"}
    />
  );
}
