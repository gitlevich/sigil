import type { Context } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WeightedItem {
  ctx: Context;
  weight: number;
}

export interface LayoutRect extends Rect {
  ctx: Context;
}

/** Recursive weight: 1 (self) + descendant count. A leaf weighs 1. */
export function computeWeight(ctx: Context): number {
  return 1 + ctx.children.reduce((s, c) => s + computeWeight(c), 0);
}

/** Compute the maximum nesting depth of a context tree. */
export function maxDepth(ctx: Context): number {
  if (ctx.children.length === 0) return 0;
  return 1 + Math.max(...ctx.children.map(maxDepth));
}

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk 1999).
 * Partitions `items` into `rect`, producing one LayoutRect per item.
 */
export function squarify(items: WeightedItem[], rect: Rect): LayoutRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ ...rect, ctx: items[0].ctx }];
  }

  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  if (totalWeight === 0) return [];

  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const results: LayoutRect[] = [];
  layoutStrip(sorted, rect, totalWeight, results);
  return results;
}

function layoutStrip(
  items: WeightedItem[],
  rect: Rect,
  totalWeight: number,
  results: LayoutRect[]
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    results.push({ ...rect, ctx: items[0].ctx });
    return;
  }

  const isWide = rect.w >= rect.h;
  let rowWeight = 0;
  let bestAspect = Infinity;
  let splitAt = 1;

  for (let i = 0; i < items.length; i++) {
    rowWeight += items[i].weight;
    const rowFraction = rowWeight / totalWeight;
    const stripSize = isWide ? rect.w * rowFraction : rect.h * rowFraction;
    const crossSize = isWide ? rect.h : rect.w;

    let worst = 0;
    let runWeight = 0;
    for (let j = 0; j <= i; j++) {
      runWeight += items[j].weight;
      const itemFraction = items[j].weight / rowWeight;
      const itemSize = crossSize * itemFraction;
      const aspect = Math.max(stripSize / itemSize, itemSize / stripSize);
      worst = Math.max(worst, aspect);
    }

    if (worst <= bestAspect) {
      bestAspect = worst;
      splitAt = i + 1;
    } else {
      break;
    }
  }

  const rowItems = items.slice(0, splitAt);
  const restItems = items.slice(splitAt);
  const rowTotalWeight = rowItems.reduce((s, it) => s + it.weight, 0);
  const rowFraction = rowTotalWeight / totalWeight;

  let rowRect: Rect;
  let restRect: Rect;

  if (isWide) {
    const stripW = rect.w * rowFraction;
    rowRect = { x: rect.x, y: rect.y, w: stripW, h: rect.h };
    restRect = { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
  } else {
    const stripH = rect.h * rowFraction;
    rowRect = { x: rect.x, y: rect.y, w: rect.w, h: stripH };
    restRect = { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
  }

  let offset = 0;
  for (const item of rowItems) {
    const fraction = item.weight / rowTotalWeight;
    if (isWide) {
      const itemH = rowRect.h * fraction;
      results.push({ x: rowRect.x, y: rowRect.y + offset, w: rowRect.w, h: itemH, ctx: item.ctx });
      offset += itemH;
    } else {
      const itemW = rowRect.w * fraction;
      results.push({ x: rowRect.x + offset, y: rowRect.y, w: itemW, h: rowRect.h, ctx: item.ctx });
      offset += itemW;
    }
  }

  if (restItems.length > 0) {
    layoutStrip(restItems, restRect, totalWeight - rowTotalWeight, results);
  }
}

/** Compute depth-based greyscale style for a treemap cell. */
export function depthStyle(
  depth: number,
  totalDepth: number,
  dark: boolean
): { background: string; color: string } {
  const rootL = dark ? 12 : 95;
  const leafL = dark ? 30 : 70;
  const range = Math.abs(leafL - rootL);
  const step = totalDepth > 0 ? range / totalDepth : 0;
  const lightness = dark
    ? Math.min(leafL, rootL + depth * step)
    : Math.max(leafL, rootL - depth * step);
  const bg = `hsl(0, 0%, ${lightness}%)`;
  const color = lightness > 45 ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 90%)";
  return { background: bg, color };
}

export const HEADER_HEIGHT = 28;
export const ICON_ROW_HEIGHT = 24;
export const FRAME_PAD = 6;
