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

export {
  LAYOUT_FILENAME,
  emptyLayout,
  defaultPosition,
  regionPosition,
  type IconPosition,
  type ScrollPanelLayout,
  type SpatialLayout,
  type IconKindForLayout,
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
