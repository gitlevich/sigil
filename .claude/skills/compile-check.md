---
description: Run the sigil spec compiler and report unresolved references.
user-invocable: true
---

# compile-check

Run `npx tsx scripts/compile-check.ts` from the project root. Report the output to the user. If there are errors, group them by file and summarize what's unresolved. If clean, say so.

Always run this after editing spec files to catch scope violations.
