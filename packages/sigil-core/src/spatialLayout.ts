/**
 * Per-sigil icon layout for the Spatial desktop (from-inside mode) — the pure
 * geometry. Persistence (reading/writing `spatial.layout.json`) is the host's
 * concern: the editor reads/writes the file through Tauri; the web viewer reads
 * a baked-in layout from the exported spec and does not write.
 *
 * The layout maps each entangled sigil's name to its `{x, y}` coordinates on
 * the canvas. Unplaced icons are composed from their relationship to the
 * inhabited sigil: doors form a threshold, gods and landmarks remain at the
 * horizon, and children unfold from the sentences connecting them.
 */

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

/** True when a parsed value is a well-formed SpatialLayout. */
export function isSpatialLayout(value: unknown): value is SpatialLayout {
  const l = value as SpatialLayout | null;
  return !!l && l.version === 1 && typeof l.icons === "object";
}

export type IconKindForLayout = "child" | "neighbor" | "god" | "narrative" | "parent" | "landmark";

export interface SpatialLayoutIcon {
  name: string;
  kind: IconKindForLayout;
}

export interface SpatialConnection {
  a: string;
  b: string;
}

interface ChildGroup {
  names: string[];
  isolated: boolean;
  order: number;
}

/**
 * Compose the Inside desktop from semantic rings and sentence connections.
 * This produces defaults only. A stored position always supersedes it in the
 * host, so the user remains the final author of the space.
 */
export function arrangeSpatialIcons(
  icons: readonly SpatialLayoutIcon[],
  connections: readonly SpatialConnection[],
  canvasWidth: number,
  canvasHeight: number,
): Record<string, IconPosition> {
  const width = Math.max(canvasWidth, 560);
  const height = Math.max(canvasHeight, 480);
  const positions: Record<string, IconPosition> = {};
  const byKind = groupByKind(icons);

  // Doors are the threshold of the room. Their fixed cadence is preferable
  // to squeezing because a long threshold can continue into scrollable space.
  placeLine(byKind.neighbor, 72, 138, 0, 132, positions);

  // Shared vocabularies gather along the near horizon. A single god stays at
  // the beginning of the row rather than floating meaninglessly at center.
  const godStartX = Math.min(280, Math.max(190, width * 0.22));
  placeLine(byKind.god, godStartX, 126, 176, 0, positions);

  // Landmarks are named territory elsewhere: visible across the room, but
  // never confused with a door through the left threshold.
  placeLine(byKind.landmark, width - 96, 144, 0, 112, positions);
  placeLine(byKind.parent, Math.max(170, width * 0.18), 126, 0, 0, positions);

  arrangeChildren(
    byKind.child.map((icon) => icon.name),
    connections,
    {
      left: 164,
      right: Math.max(404, width - 112),
      top: Math.max(248, Math.min(326, height * 0.36)),
      bottom: Math.max(418, height - 174),
    },
    positions,
  );

  // Language is a surface of my body, kept low and close to the threshold.
  // On a crowded desktop it follows the last door or child into scrollable
  // space instead of occupying the same coordinates.
  const lowestContent = [...byKind.neighbor, ...byKind.child]
    .reduce((lowest, icon) => Math.max(lowest, positions[icon.name]?.y ?? 0), 0);
  placeLine(byKind.narrative, 60, Math.max(height - 104, lowestContent + 120), 0, 0, positions);

  return positions;
}

function groupByKind(icons: readonly SpatialLayoutIcon[]): Record<IconKindForLayout, SpatialLayoutIcon[]> {
  const groups: Record<IconKindForLayout, SpatialLayoutIcon[]> = {
    child: [],
    neighbor: [],
    god: [],
    narrative: [],
    parent: [],
    landmark: [],
  };
  for (const icon of icons) groups[icon.kind].push(icon);
  return groups;
}

function placeLine(
  icons: readonly SpatialLayoutIcon[],
  x: number,
  y: number,
  dx: number,
  dy: number,
  positions: Record<string, IconPosition>,
): void {
  icons.forEach((icon, index) => {
    positions[icon.name] = { x: x + dx * index, y: y + dy * index };
  });
}

interface ChildBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function arrangeChildren(
  names: readonly string[],
  connections: readonly SpatialConnection[],
  bounds: ChildBounds,
  positions: Record<string, IconPosition>,
): void {
  if (names.length === 0) return;

  const nameSet = new Set(names);
  const iconOrder = new Map(names.map((name, index) => [name, index]));
  const relationOrder = new Map<string, number>();
  const adjacency = new Map(names.map((name) => [name, new Set<string>()]));
  const seenEdges = new Set<string>();

  for (const connection of connections) {
    if (!nameSet.has(connection.a) || !nameSet.has(connection.b) || connection.a === connection.b) continue;
    if (!relationOrder.has(connection.a)) relationOrder.set(connection.a, relationOrder.size);
    if (!relationOrder.has(connection.b)) relationOrder.set(connection.b, relationOrder.size);
    const key = edgeKey(connection.a, connection.b);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    adjacency.get(connection.a)!.add(connection.b);
    adjacency.get(connection.b)!.add(connection.a);
  }

  const rank = (name: string) => relationOrder.get(name) ?? (connections.length * 2 + (iconOrder.get(name) ?? 0));
  const components = connectedComponents(names, adjacency, rank);
  const isolated = components.filter((component) => component.length === 1).flat();
  const groups: ChildGroup[] = components
    .filter((component) => component.length > 1)
    .map((component) => ({ names: component, isolated: false, order: Math.min(...component.map(rank)) }));
  if (isolated.length > 0) {
    groups.push({ names: isolated.sort((a, b) => rank(a) - rank(b)), isolated: true, order: Math.min(...isolated.map(rank)) });
  }
  groups.sort((a, b) => a.order - b.order);

  const groupGap = 52;
  const desiredHeights = groups.map((group) => desiredGroupHeight(group.names.length, group.isolated, bounds));
  const desiredTotal = desiredHeights.reduce((sum, value) => sum + value, 0) + groupGap * Math.max(0, groups.length - 1);
  const available = Math.max(bounds.bottom - bounds.top, desiredTotal);
  const extraPerGroup = (available - desiredTotal) / groups.length;
  let top = bounds.top;

  groups.forEach((group, index) => {
    const height = desiredHeights[index] + extraPerGroup;
    const groupBounds = { ...bounds, top, bottom: top + height };
    if (group.isolated) {
      arrangeIsolatedChildren(group.names, groupBounds, positions);
    } else {
      arrangeConnectedChildren(group.names, adjacency, rank, groupBounds, positions);
    }
    top += height + groupGap;
  });
}

function connectedComponents(
  names: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  rank: (name: string) => number,
): string[][] {
  const remaining = new Set(names);
  const components: string[][] = [];
  for (const first of names) {
    if (!remaining.has(first)) continue;
    const component: string[] = [];
    const queue = [first];
    remaining.delete(first);
    for (let index = 0; index < queue.length; index++) {
      const name = queue[index];
      component.push(name);
      const neighbors = [...(adjacency.get(name) ?? [])].sort((a, b) => rank(a) - rank(b));
      for (const neighbor of neighbors) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(component.sort((a, b) => rank(a) - rank(b)));
  }
  return components;
}

function desiredGroupHeight(count: number, isolated: boolean, bounds: ChildBounds): number {
  if (!isolated) return Math.min(390, 190 + Math.max(0, count - 3) * 42);
  const columns = gridColumns(count, bounds);
  return Math.max(150, Math.ceil(count / columns) * 108);
}

function arrangeIsolatedChildren(
  names: readonly string[],
  bounds: ChildBounds,
  positions: Record<string, IconPosition>,
): void {
  const columns = gridColumns(names.length, bounds);
  const rows = Math.ceil(names.length / columns);
  names.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions[name] = {
      x: coordinateInRange(column, columns, bounds.left, bounds.right),
      y: coordinateInRange(row, rows, bounds.top + 42, bounds.bottom - 42),
    };
  });
}

function gridColumns(count: number, bounds: ChildBounds): number {
  const aspect = Math.max(1, (bounds.right - bounds.left) / Math.max(1, bounds.bottom - bounds.top));
  return Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
}

/**
 * The first relation reached from the earliest leaf becomes the narrative
 * spine. Equidistant endings prefer the later-mentioned leaf, allowing a
 * sentence chain to keep unfolding instead of folding back on itself.
 * Remaining branches travel in lanes above that spine.
 */
function arrangeConnectedChildren(
  names: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  rank: (name: string) => number,
  bounds: ChildBounds,
  positions: Record<string, IconPosition>,
): void {
  const leaves = names.filter((name) => (adjacency.get(name)?.size ?? 0) <= 1);
  const start = [...(leaves.length > 0 ? leaves : names)].sort((a, b) => rank(a) - rank(b))[0];
  const fromStart = breadthFirst(start, adjacency, rank);
  const end = [...names].sort((a, b) => {
    const distance = (fromStart.distance.get(b) ?? -1) - (fromStart.distance.get(a) ?? -1);
    return distance || rank(b) - rank(a);
  })[0];
  const spine = pathTo(start, end, fromStart.parent);
  const spineSet = new Set(spine);
  const branchNames = names.filter((name) => !spineSet.has(name));
  const spineY = branchNames.length > 0 ? bounds.bottom - 44 : (bounds.top + bounds.bottom) / 2;

  spine.forEach((name, index) => {
    positions[name] = {
      x: coordinateInRange(index, spine.length, bounds.left, bounds.right),
      y: spineY,
    };
  });

  if (branchNames.length === 0) return;

  const owner = new Map<string, string>();
  const depth = new Map<string, number>();
  const queue = [...spine];
  for (const name of spine) {
    owner.set(name, name);
    depth.set(name, 0);
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const neighbors = [...(adjacency.get(current) ?? [])].sort((a, b) => rank(a) - rank(b));
    for (const neighbor of neighbors) {
      if (owner.has(neighbor)) continue;
      owner.set(neighbor, owner.get(current)!);
      depth.set(neighbor, (depth.get(current) ?? 0) + 1);
      queue.push(neighbor);
    }
  }

  const maxDepthByOwner = new Map<string, number>();
  for (const name of branchNames) {
    const root = owner.get(name)!;
    maxDepthByOwner.set(root, Math.max(maxDepthByOwner.get(root) ?? 0, depth.get(name) ?? 1));
  }
  const horizontalStep = Math.min(174, Math.max(104, (bounds.right - bounds.left) / Math.max(5, spine.length)));
  const branchSlot = new Map<string, number>();

  branchNames.sort((a, b) => (depth.get(a)! - depth.get(b)!) || rank(a) - rank(b)).forEach((name) => {
    const root = owner.get(name)!;
    const rootX = positions[root].x;
    const maxDepth = maxDepthByOwner.get(root) ?? 1;
    const direction = rootX + horizontalStep * maxDepth <= bounds.right ? 1 : -1;
    const slotKey = `${root}:${depth.get(name)}`;
    const slot = branchSlot.get(slotKey) ?? 0;
    branchSlot.set(slotKey, slot + 1);
    const laneY = spineY - 104 * (slot + 1);
    positions[name] = {
      x: clamp(rootX + direction * horizontalStep * (depth.get(name) ?? 1), bounds.left, bounds.right),
      y: Math.max(bounds.top + 38, laneY),
    };
  });
}

function breadthFirst(
  start: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  rank: (name: string) => number,
): { distance: Map<string, number>; parent: Map<string, string> } {
  const distance = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string>();
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const neighbors = [...(adjacency.get(current) ?? [])].sort((a, b) => rank(a) - rank(b));
    for (const neighbor of neighbors) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, (distance.get(current) ?? 0) + 1);
      parent.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  return { distance, parent };
}

function pathTo(start: string, end: string, parent: ReadonlyMap<string, string>): string[] {
  const path = [end];
  while (path[0] !== start) {
    const previous = parent.get(path[0]);
    if (!previous) return [start];
    path.unshift(previous);
  }
  return path;
}

function coordinateInRange(index: number, count: number, start: number, end: number): number {
  return count <= 1 ? (start + end) / 2 : start + ((end - start) * index) / (count - 1);
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
