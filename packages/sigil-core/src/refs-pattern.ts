/**
 * Shared reference pattern and code-span detection.
 *
 * Used by the editor (syntax highlighting, autocomplete, hover)
 * and the compiler (error checking) — must be identical in both.
 */

/** Matches @sigil, @A@B chains, @A#affordance, @A!invariant, #affordance, !invariant. */
export const allRefsPattern =
  /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

/** Returns true if matchIndex falls inside an inline code span (backtick-delimited). */
export function isInCodeSpan(lineText: string, matchIndex: number): boolean {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (lineText[i] === "`") count++;
  }
  return count % 2 === 1;
}
