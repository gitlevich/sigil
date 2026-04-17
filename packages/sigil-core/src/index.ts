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
export type { Vocabulary, CoOccurrence, SigilNode, SigilSpace } from "./sigilSpace";
export {
  build as buildSigilSpace,
  distance as sigilDistance,
  neighbors as sigilNeighbors,
  displacement as sigilDisplacement,
  rebuild as rebuildSigilSpace,
} from "./sigilSpace";
export type { NameMisfit, NameMisfitOptions } from "./nameMisfit";
export { detectNameMisfits } from "./nameMisfit";
export type { Rect, WeightedItem, LayoutRect } from "./treemap";
export {
  computeWeight, maxDepth, squarify, depthStyle,
  HEADER_HEIGHT, ICON_ROW_HEIGHT, FRAME_PAD,
} from "./treemap";
