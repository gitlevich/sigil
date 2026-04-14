export type { Affordance, Invariant, Sigil, Context } from "./types";
export { findContext, buildBreadcrumb, flattenPaths, buildPath, makeSummary } from "./tree";
export { stripFrontmatter } from "./frontmatter";
export type { Ref } from "./refs";
export {
  flattenName,
  fromDashForm,
  buildNameIndex,
  resolveRefName,
  resolveRefNameAll,
  findAffordance,
  findInvariantInScope,
  findAffordanceInScope,
  buildLexicalScope,
} from "./refs";
export type { Segment } from "./highlight";
export { styleForPrefix, buildRefPattern, buildRefLookup, highlightText } from "./highlight";
export type { ScopeKind, ScopeResolution, ScopeItem } from "./lexicalScope";
export { isInScope, resolve, buildScope } from "./lexicalScope";
export { allRefsPattern, isInCodeSpan } from "./refs-pattern";
export type { CoOccurrenceMap } from "./coOccurrence";
export {
  extractCoOccurrences,
  coOccurrenceCount,
  coOccurrenceDistance,
  parsePairKey,
} from "./coOccurrence";
export type { Rect, WeightedItem, LayoutRect } from "./treemap";
export {
  computeWeight, maxDepth, squarify, depthStyle,
  HEADER_HEIGHT, ICON_ROW_HEIGHT, FRAME_PAD,
} from "./treemap";
