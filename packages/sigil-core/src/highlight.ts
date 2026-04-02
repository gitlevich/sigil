import type { Ref } from "./refs";

/** A segment of text produced by highlighting: either plain text or a resolved ref match. */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "ref"; text: string; ref: Ref; prefix: "@" | "#" | "!"; navigateTo?: string };

const STYLE_FOR_PREFIX: Record<string, string> = {
  "@": "ref-context",
  "#": "ref-affordance",
  "!": "ref-invariant",
};

export function styleForPrefix(prefix: string): string {
  return STYLE_FOR_PREFIX[prefix] || "ref-context";
}

type RefLookup = Record<string, Ref>;

function buildInflectedNames(refs: Ref[]): string[] {
  const escaped = refs.map((r) =>
    r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const unique = [...new Set(escaped)];
  const inflected: string[] = [];
  for (const name of unique) {
    inflected.push(name);
    if (/e$/i.test(name)) {
      inflected.push(name + "d");
      inflected.push(name.slice(0, -1) + "ing");
    } else {
      inflected.push(name + "ed");
      inflected.push(name + "ing");
    }
    inflected.push(name + "s");
  }
  return [...new Set(inflected)];
}

/** Build the regex pattern that matches prefixed ref names including inflected forms.
 *
 *  Matches:
 *  - @Context#affordance or @Context!invariant (compound, highlighted as the property type)
 *  - @Context, #affordance, !invariant (simple)
 */
export function buildRefPattern(refs: Ref[]): RegExp | null {
  if (refs.length === 0) return null;
  const names = buildInflectedNames(refs);
  const alt = names.join("|");
  // Group 1: @-led context name
  // Group 2: property prefix (# or !) in compound ref
  // Group 3: property name in compound ref (any word, not just known refs)
  // Group 4: standalone prefix (# or !)
  // Group 5: standalone name
  return new RegExp(
    `@(${alt})(?:([#!])([a-zA-Z_][\\w-]*))?\\b|([#!])(${alt})\\b`,
    "gi"
  );
}

/** Build a lookup map from prefix+name to Ref, including inflected forms. */
export function buildRefLookup(refs: Ref[]): RefLookup {
  const map: RefLookup = {};
  for (const r of refs) {
    map[`${r.prefix}${r.name.toLowerCase()}`] = r;
    const name = r.name.toLowerCase();
    if (name.endsWith("e")) {
      map[`${r.prefix}${name}d`] = r;
      map[`${r.prefix}${name.slice(0, -1)}ing`] = r;
    } else {
      map[`${r.prefix}${name}ed`] = r;
      map[`${r.prefix}${name}ing`] = r;
    }
    map[`${r.prefix}${name}s`] = r;
  }
  return map;
}

/** Segment text into plain strings and resolved ref matches. */
export function highlightText(
  text: string,
  pattern: RegExp,
  lookup: RefLookup
): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      // @-led ref
      const contextName = match[1];
      const propPrefix = match[2] as "#" | "!" | undefined;
      const propName = match[3];

      if (propPrefix && propName) {
        // Compound: @Context#affordance or @Context!invariant
        const propRef = lookup[`${propPrefix}${propName.toLowerCase()}`];
        const contextRef = lookup[`@${contextName.toLowerCase()}`];
        const ref = propRef || contextRef;
        if (ref) {
          segments.push({
            kind: "ref",
            text: match[0],
            ref: propRef || ref,
            prefix: propPrefix,
            navigateTo: (propRef || ref).navigateTo ?? contextName,
          });
        } else {
          segments.push({ kind: "text", text: match[0] });
        }
      } else {
        // Simple @Context
        const ref = lookup[`@${contextName.toLowerCase()}`];
        if (ref) {
          segments.push({
            kind: "ref",
            text: match[0],
            ref,
            prefix: "@",
            navigateTo: ref.navigateTo ?? contextName,
          });
        } else {
          segments.push({ kind: "text", text: match[0] });
        }
      }
    } else {
      // Standalone #affordance or !invariant
      const prefix = match[4] as "#" | "!";
      const name = match[5];
      const ref = lookup[`${prefix}${name.toLowerCase()}`];
      if (ref) {
        segments.push({
          kind: "ref",
          text: match[0],
          ref,
          prefix,
          navigateTo: ref.navigateTo ?? name,
        });
      } else {
        segments.push({ kind: "text", text: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
