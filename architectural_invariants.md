# Architectural Invariants

The spec at `specification.sigil/` is the prototype for the code. These two rules apply to every sigil that gets implemented, application-wide. They are non-negotiable.

**Shape correspondence.** Every directory in the spec becomes a module. Every leaf sigil becomes a file. The path through the spec is the path through the code. No flattening, no invented groupings. Implementation details live as private items inside the module that owns them — they never create new siblings at the spec level.

**Name invariance.** Code uses spec names exactly, adapted only to the target language's naming convention (snake_case in Rust, camelCase in TypeScript). No synonyms, no abbreviations, no "cleaner" alternatives. The spec is the vocabulary.

Infrastructure shared across the system (SQLite, embedding provider) lives outside the spec-derived modules — these are services the application uses, not parts of any sigil.
