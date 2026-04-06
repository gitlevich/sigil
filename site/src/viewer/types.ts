export type { Affordance, Invariant } from "sigil-core";
export type { Sigil as Context } from "sigil-core";

/** The shape produced by export-sigil-json.ts: a named spec with vision + root context. */
export interface Sigil {
  name: string;
  vision: string;
  root: import("sigil-core").Sigil;
}
