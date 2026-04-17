/**
 * Per-sigil icon layout for the Spatial desktop (from-inside mode).
 *
 * Persisted as `spatial.layout.json` inside each sigil directory, alongside
 * `affordance.folded` and `invariant.folded`. The layout maps each entangled
 * sigil's name to its `{x, y}` coordinates on the canvas. Unplaced icons fall
 * back to a deterministic hashed default so successive visits produce stable
 * positions and icons never pile on top of each other.
 */
import { api } from "../tauri";

export const LAYOUT_FILENAME = "spatial.layout.json";

export interface IconPosition {
  x: number;
  y: number;
}

export interface SpatialLayout {
  version: 1;
  icons: Record<string, IconPosition>;
}

export function emptyLayout(): SpatialLayout {
  return { version: 1, icons: {} };
}

export async function readLayout(sigilPath: string): Promise<SpatialLayout> {
  try {
    const raw = await api.readFile(`${sigilPath}/${LAYOUT_FILENAME}`);
    const parsed = JSON.parse(raw) as SpatialLayout;
    if (parsed && parsed.version === 1 && typeof parsed.icons === "object") {
      return parsed;
    }
  } catch {
    // File doesn't exist or is malformed — return empty layout.
  }
  return emptyLayout();
}

export async function writeLayout(sigilPath: string, layout: SpatialLayout): Promise<void> {
  await api.writeFile(`${sigilPath}/${LAYOUT_FILENAME}`, JSON.stringify(layout, null, 2));
}

/**
 * Deterministic default position for an unplaced icon. Fans icons out in a
 * logarithmic spiral seeded by the sigil's name, clamped to the canvas.
 */
export function defaultPosition(name: string, index: number, canvasWidth: number, canvasHeight: number): IconPosition {
  const hash = hashString(name);
  const angle = (index * 2.399) + (hash % 360) * (Math.PI / 180); // golden-angle fan-out, offset by hash
  const radius = 60 + Math.sqrt(index) * 55;
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  let x = cx + radius * Math.cos(angle);
  let y = cy + radius * Math.sin(angle);
  // Clamp with margin so icons stay on-screen.
  const margin = 60;
  x = Math.max(margin, Math.min(canvasWidth - margin, x));
  y = Math.max(margin + 40, Math.min(canvasHeight - margin, y));
  return { x, y };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}
