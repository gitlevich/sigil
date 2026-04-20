export type { Affordance, Invariant, Sigil, Context } from "./types";
export { findContext, buildBreadcrumb, flattenPaths, buildPath, makeSummary } from "./tree";
export { stripFrontmatter } from "./frontmatter";
export type { NameIndex, Ref } from "./refs";
export {
  flattenName,
  fromDashForm,
  inflectionsOf,
  nameMatches,
  buildNameIndex,
  resolveRefName,
  resolveRefNameAll,
  findAffordance,
  findChildrenByName,
  findDescendantsByName,
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
export type { OutgrownPlacement, OutgrownPlacementOptions, Attendant } from "./outgrownPlacement";
export { detectOutgrownPlacements } from "./outgrownPlacement";
export type { EmergenceAnchorOptions } from "./emergenceAnchor";
export { isEmergenceAnchored } from "./emergenceAnchor";
export type { AwakeningPhase, AwakeningEvent } from "./awakening";
export {
  AWAKENING_PHASE_ORDER,
  subscribeAwakening,
  publishAwakeningPhase,
} from "./awakening";
export type {
  Disturbance,
  SpellResult,
  SpellDirective,
  Spell,
  Spellbook,
  Consultation,
} from "./subconscious";
export { consultSpellbook, emptySpellbook } from "./subconscious";
export { compressSigil, extractThesis } from "./compressor";
export type { TemporalEvent } from "./temporalCompressor";
export { sinceLast, filterByPull } from "./temporalCompressor";
export type { Focus, AttentionState } from "./attention";
export {
  init as initAttention,
  shift as shiftAttention,
  anchorTo as anchorAttention,
  currentFocus,
  walkedPath,
} from "./attention";
export type { Rect, WeightedItem, LayoutRect } from "./treemap";
export {
  computeWeight, maxDepth, squarify, depthStyle,
  HEADER_HEIGHT, ICON_ROW_HEIGHT, FRAME_PAD,
} from "./treemap";
