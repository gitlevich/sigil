/**
 * Deterministic per-sigil color. Used to color-sign @Children on the
 * @Spatial desktop and to tint their names wherever they appear in the
 * parent sigil's @language text, so entanglement is visible in the prose.
 *
 * Hue is hashed from the name. Saturation and lightness are tuned to read
 * in both light and dark themes without clashing with the editor chrome.
 */
const SATURATION = 62;
const LIGHTNESS = 52;

export function colorForSigilName(name: string): string {
  const hue = hueFromName(name);
  return `hsl(${hue}deg ${SATURATION}% ${LIGHTNESS}%)`;
}

/** A soft variant for backgrounds, panels, or hover fills of the same sigil's color. */
export function softColorForSigilName(name: string, alpha = 0.18): string {
  const hue = hueFromName(name);
  return `hsla(${hue}deg ${SATURATION}% ${LIGHTNESS}% / ${alpha})`;
}

function hueFromName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}
