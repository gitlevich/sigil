/**
 * Pure geometry for StructuralView3D — extracted so the placement math is
 * testable without three.js or a canvas.
 *
 * The focused sigil is a sphere of a given radius with an opening at the
 * south pole (the way back to the parent). Children float inside on a
 * fibonacci shell. Siblings — neighbors living in parallel sigils, i.e. the
 * parent's other children — sit on the wall: from inside they read as
 * spheres overlapping mine, from outside as connections reaching out to the
 * neighboring sigils.
 */

export interface WallPlacement {
  /** Point on the sphere wall. */
  pos: [number, number, number];
  /** Unit vector from that point toward the sphere center. */
  inward: [number, number, number];
}

/** Golden-angle spiral points on a sphere of given radius. */
export function fibonacciSphere(n: number, radius: number): [number, number, number][] {
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN * i;
    out.push([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]);
  }
  return out;
}

/**
 * Distribute n sibling contact points on the wall, over the cap that remains
 * after the south-pole opening (openingTheta..0), pulled slightly clear of
 * the rim so nothing crowds the door.
 */
export function siblingWallPlacements(
  n: number,
  radius: number,
  openingTheta: number,
): WallPlacement[] {
  if (n === 0) return [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const thetaMax = openingTheta - 0.08;
  const yMin = Math.cos(thetaMax);
  const yMax = Math.cos(0) - 0.001;
  const out: WallPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const y = yMax - ((yMax - yMin) * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    const ux = Math.cos(theta) * r;
    const uz = Math.sin(theta) * r;
    out.push({
      pos: [ux * radius, y * radius, uz * radius],
      inward: [-ux, -y, -uz],
    });
  }
  return out;
}

/**
 * The outward end of a connection reaching from a wall contact point to the
 * neighbor sigil it stands for: the wall point pushed `length` along the
 * outward normal (the opposite of `inward`).
 */
export function connectionNode(
  pos: [number, number, number],
  inward: [number, number, number],
  length: number,
): [number, number, number] {
  return [
    pos[0] - inward[0] * length,
    pos[1] - inward[1] * length,
    pos[2] - inward[2] * length,
  ];
}
