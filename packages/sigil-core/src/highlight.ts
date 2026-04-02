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

/** Build the regex pattern that matches prefixed ref names including inflected forms. */
export function buildRefPattern(refs: Ref[]): RegExp | null {
  if (refs.length === 0) return null;
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
  const uniqueInflected = [...new Set(inflected)];
  return new RegExp(
    `([@#!])(${uniqueInflected.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`,
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
    const prefix = match[1] as "@" | "#" | "!";
    const name = match[2];
    const ref = lookup[`${prefix}${name.toLowerCase()}`];
    if (!ref) {
      segments.push({ kind: "text", text: match[0] });
    } else {
      segments.push({
        kind: "ref",
        text: match[0],
        ref,
        prefix,
        navigateTo: ref.navigateTo ?? name,
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
