/**
 * LayoutStore — the persistence port for the Spatial desktop.
 *
 * The SpatialDesktop component owns the arrangement but not where it is kept.
 * A host injects one implementation: the editor saves each sigil's layout to
 * `spatial.layout.json` on disk via Tauri; the web viewer keeps it in the
 * browser's localStorage (falling back to the layout baked into the exported
 * spec). Both receive the sigil node and its path so each can key storage its
 * own way — by filesystem path, or by position in the tree.
 */
import type { Sigil } from "./types";
import type { SpatialLayout } from "./spatialLayout";

export interface LayoutStore {
  /** The saved layout for a sigil; an empty/default layout if none exists. */
  load(folder: Sigil, path: string[]): Promise<SpatialLayout>;
  /** Persist a sigil's layout. */
  save(folder: Sigil, path: string[], layout: SpatialLayout): Promise<void>;
}
