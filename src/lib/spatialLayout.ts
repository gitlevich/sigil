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

export interface ScrollPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Was the scroll open when I last left this sigil? Per-sigil memory. */
  open?: boolean;
}

export interface SpatialLayout {
  version: 1;
  icons: Record<string, IconPosition>;
  scroll?: ScrollPanelLayout;
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

export type IconKindForLayout = "child" | "neighbor" | "god" | "narrative" | "parent" | "landmark";

/**
 * Region-based placement. Each kind lives in a dedicated zone of the canvas
 * so you know where to look, and new items within a kind are laid out in
 * order. Predictable, composed — not a dump.
 *
 *   Top band          — gods, horizontal row under the parent chevron
 *   Left column       — neighbor doors, stacked
 *   Interior          — children in a golden-angle spiral from the center
 *   Bottom-left       — narrative scroll, fixed anchor
 *
 * Canvas margins account for the affordance row (top ~120px) and the
 * invariant row (bottom ~70px).
 */
export function regionPosition(
  kind: IconKindForLayout,
  indexInKind: number,
  countInKind: number,
  canvasWidth: number,
  canvasHeight: number,
): IconPosition {
  // Top-down composition:
  //   affordance row at the very top          (y=12, ~36px tall)
  //   parent triangle in the top band below   (center ~y=110)
  //   gods band alongside/below parent        (y ~180)
  //   interior begins                         (y ~260)
  const godBandY = 180;
  const topReserved = 260;
  const bottomReserved = 90;   // invariant row clearance
  const leftWall = 72;
  const rightWall = canvasWidth - 72;
  const interiorTop = topReserved;
  const interiorBottom = canvasHeight - bottomReserved - 40;
  const interiorLeft = leftWall + 120; // leave room for neighbor doors
  const interiorRight = rightWall - 40;

  if (kind === "parent") {
    // Top-left quadrant, above the gods band but below the affordance row.
    return { x: Math.max(120, canvasWidth * 0.22), y: 110 };
  }

  if (kind === "narrative") {
    return { x: 60, y: canvasHeight - bottomReserved - 20 };
  }

  if (kind === "god") {
    const usableWidth = (rightWall - 40) - (leftWall + 40);
    const gap = countInKind > 1 ? usableWidth / (countInKind - 1) : 0;
    const startX = countInKind === 1 ? canvasWidth / 2 : leftWall + 40;
    return { x: startX + gap * indexInKind, y: godBandY };
  }

  if (kind === "neighbor") {
    // Doors along the left wall, evenly stacked from just below gods band.
    const slotHeight = 136;
    const firstY = interiorTop + 30;
    return { x: leftWall, y: firstY + indexInKind * slotHeight };
  }

  if (kind === "landmark") {
    // Diamonds along the right wall — distant sigils I named but that don't
    // live next door. Mirrors the neighbor column on the opposite side.
    const slotHeight = 100;
    const firstY = interiorTop + 30;
    return { x: rightWall, y: firstY + indexInKind * slotHeight };
  }

  // Children: golden-angle spiral from the interior center.
  if (kind === "child") {
    if (countInKind === 1) {
      return { x: (interiorLeft + interiorRight) / 2, y: (interiorTop + interiorBottom) / 2 };
    }
    const cx = (interiorLeft + interiorRight) / 2;
    const cy = (interiorTop + interiorBottom) / 2;
    const rSpan = Math.min((interiorRight - interiorLeft), (interiorBottom - interiorTop)) / 2 - 30;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const angle = indexInKind * GOLDEN;
    const radius = Math.sqrt((indexInKind + 0.5) / countInKind) * rSpan;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return { x, y };
  }

  return { x: canvasWidth / 2, y: canvasHeight / 2 };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}
