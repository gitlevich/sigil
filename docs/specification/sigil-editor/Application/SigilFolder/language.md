---
status: implemented
---

# Sigil Folder

A folder has a natural structure for storing @sigils. This is where a @sigil lives on a file system. Also how it can propagate: just one folder with everything. like one bagel.

A sigil folder contains:

- @LanguageFile where the @sigil is defined
- @AffordanceFiles, describing every affordance the @sigil provides
- @InvariantFiles, describing this @sigil's invariants
- @SigilFolders of contained @sigils

