/**
 * SpatialDesktop (editor wrapper) — feeds the shared sigil-core component the
 * editor's live workspace state, Tauri-backed layout persistence, and the
 * editor-only "Through" POV view.
 */
import { useWorkspaceState, useWorkspaceActions, resolveCurrentFolder } from "../../state/WorkspaceContext";
import { tauriLayoutStore } from "../../lib/spatialLayout";
import type { Sigil } from "sigil-core";
import { SpatialDesktop as SpatialDesktopView } from "sigil-core/react/SpatialDesktop";
import { ThroughView } from "./ThroughView";

export function SpatialDesktop() {
  const ws = useWorkspaceState();
  const { navigate } = useWorkspaceActions();
  const folder = resolveCurrentFolder(ws) as unknown as Sigil | null;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";

  return (
    <SpatialDesktopView
      folder={folder}
      currentPath={ws.currentPath}
      rootName={ws.spec.name}
      mainRoot={ws.spec.root as unknown as Sigil}
      importedRoot={(ws.spec.importedOntologies as unknown as Sigil) ?? null}
      navigate={navigate}
      layoutStore={tauriLayoutStore}
      dark={dark}
      renderThrough={() => <ThroughView />}
    />
  );
}
