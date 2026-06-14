/**
 * Browser-local persistence for the read-only viewer's UI state.
 *
 * Two slices: the chrome (which tabs/panels are open, sidebar width) and the
 * per-sigil Spatial-desktop layout (icon positions + scroll panel). The editor
 * persists layout to disk via Tauri; the web viewer has no disk, so it keeps
 * the user's arrangement in localStorage instead of resetting on every reload.
 */
import { emptyLayout, type SpatialLayout } from "sigil-core/spatialLayout";
import type { LayoutStore } from "sigil-core/layoutStore";
import type { Sigil } from "sigil-core";
import type { ContentTab, SidebarTab } from "./ViewerState";

const CHROME_KEY = "sigil-viewer-chrome";
const LAYOUTS_KEY = "sigil-viewer-layouts";

export interface ViewerChrome {
  contentTab?: ContentTab;
  sidebarTab?: SidebarTab;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // private mode, disabled storage, or malformed JSON
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or over quota — persistence is best-effort.
  }
}

export function loadChrome(): ViewerChrome {
  return read<ViewerChrome>(CHROME_KEY) ?? {};
}

/** Merge a partial chrome update into the stored chrome. */
export function saveChrome(patch: ViewerChrome): void {
  write(CHROME_KEY, { ...loadChrome(), ...patch });
}

/** The saved Spatial layout for a sigil, keyed by its path; null if none. */
export function loadLayout(pathKey: string): SpatialLayout | null {
  const all = read<Record<string, SpatialLayout>>(LAYOUTS_KEY) ?? {};
  return all[pathKey] ?? null;
}

export function saveLayout(pathKey: string, layout: SpatialLayout): void {
  const all = read<Record<string, SpatialLayout>>(LAYOUTS_KEY) ?? {};
  all[pathKey] = layout;
  write(LAYOUTS_KEY, all);
}

const layoutKey = (path: string[]) => path.join(" ");

/**
 * The web viewer's LayoutStore: the user's own arrangement in localStorage,
 * keyed by the sigil's path in the tree, falling back to the layout baked into
 * the exported spec, then to an empty layout.
 */
export const browserLayoutStore: LayoutStore = {
  load: (folder: Sigil, path: string[]) =>
    Promise.resolve(loadLayout(layoutKey(path)) ?? folder.spatialLayout ?? emptyLayout()),
  save: (_folder: Sigil, path: string[], layout: SpatialLayout) => {
    saveLayout(layoutKey(path), layout);
    return Promise.resolve();
  },
};
