/**
 * Per-sigil icon layout for the Spatial desktop (from-inside mode) — the
 * editor's Tauri-backed persistence. The geometry (placement math, types) lives
 * in sigil-core so the web viewer can share it; here we add reading/writing
 * `spatial.layout.json` inside each sigil directory.
 */
import { api } from "../tauri";
import {
  LAYOUT_FILENAME,
  emptyLayout,
  isSpatialLayout,
  type SpatialLayout,
} from "sigil-core/spatialLayout";
import type { LayoutStore } from "sigil-core/layoutStore";
import type { Sigil } from "sigil-core";

export {
  LAYOUT_FILENAME,
  emptyLayout,
  arrangeSpatialIcons,
  type IconPosition,
  type ScrollPanelLayout,
  type SpatialLayout,
  type IconKindForLayout,
  type SpatialConnection,
  type SpatialLayoutIcon,
} from "sigil-core/spatialLayout";

export async function readLayout(sigilPath: string): Promise<SpatialLayout> {
  try {
    const raw = await api.readFile(`${sigilPath}/${LAYOUT_FILENAME}`);
    const parsed = JSON.parse(raw) as unknown;
    if (isSpatialLayout(parsed)) return parsed;
  } catch {
    // File doesn't exist or is malformed — return empty layout.
  }
  return emptyLayout();
}

export async function writeLayout(sigilPath: string, layout: SpatialLayout): Promise<void> {
  await api.writeFile(`${sigilPath}/${LAYOUT_FILENAME}`, JSON.stringify(layout, null, 2));
}

/**
 * The editor's LayoutStore: each sigil's arrangement lives in its own
 * `spatial.layout.json` on disk, keyed by the folder's filesystem path.
 */
export const tauriLayoutStore: LayoutStore = {
  load: (folder: Sigil) => readLayout((folder as unknown as { path: string }).path),
  save: (folder: Sigil, _path: string[], layout: SpatialLayout) =>
    writeLayout((folder as unknown as { path: string }).path, layout),
};
