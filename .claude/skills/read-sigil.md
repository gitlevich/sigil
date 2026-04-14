---
description: Read a sigil subtree as one JSON object — language, affordances, invariants, and all children. Use this instead of reading spec files individually.
user-invocable: true
---

# read-sigil

Read a sigil subtree by running `npx tsx scripts/read-sigil.ts [path]` from the project root.

The path argument is slash-separated from the spec root, e.g. `DesignPartner/BicameralMind/RightHemisphere`. Omit it to read the entire spec.

The output is a JSON tree matching the `Sigil` type from sigil-core. Each node has `name`, `language`, `affordances`, `invariants`, and `children`. Use this to ingest a full sigil in one call instead of stitching together dozens of file reads.
