export type { Affordance, Invariant, Context, Sigil } from "./types";
export { findContext, buildBreadcrumb, flattenPaths, buildPath, makeSummary } from "./tree";
export { stripFrontmatter } from "./frontmatter";
export type { Ref } from "./refs";
export {
  flattenName,
  fromDashForm,
  buildNameIndex,
  resolveRefName,
  findAffordance,
  findInvariantInScope,
  findAffordanceInScope,
  buildLexicalScope,
} from "./refs";
export type { Segment } from "./highlight";
export { styleForPrefix, buildRefPattern, buildRefLookup, highlightText } from "./highlight";
export type { Rect, WeightedItem, LayoutRect } from "./treemap";
export {
  computeWeight, maxDepth, squarify, depthStyle,
  HEADER_HEIGHT, ICON_ROW_HEIGHT, FRAME_PAD,
} from "./treemap";
