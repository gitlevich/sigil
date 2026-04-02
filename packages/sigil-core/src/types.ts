export interface Affordance {
  name: string;
  content: string;
}

export interface Invariant {
  name: string;
  content: string;
}

export interface Context {
  name: string;
  domain_language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Context[];
}

export interface Sigil {
  name: string;
  vision: string;
  root: Context;
}
