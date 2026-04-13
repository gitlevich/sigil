---
status: idea
---

# Implementation

This is where we address the how of @Memory.

Note change of perspective: "I" describing @DesignPartner changes to "we", so it's no longer his POV.

A remembered @sigil is a sphere in @ContrastSpace, positioned by @CoOccurrenceGeometry. The @RightHemisphere recognizes a @shape by its proximity to a remembered sphere. Recognition produces a @sigil#name, @sigil#affordances, and @sigil#invariants — the vocabulary the @LeftHemisphere needs to generate sentences about that @sigil.

Storage is geometric. #remember-a-sigil names a @sigil in @ContrastSpace, which places its sphere among the others. #recognize-familiar-sigil finds the nearest remembered sphere to the current @shape and retrieves its vocabulary. #merge-sigils wraps a cluster of co-occurring @sigils into one and names it. #forget is passive — spheres not reinforced by #consolidate or #recall lose definition until recognition fails.

Acceptance criteria:

!geometric-storage — a remembered @sigil is a sphere in @ContrastSpace with a @Sigil#name, @affordances, and @invariants attached

!vocabulary-retrieval — #recognize-familiar-sigil delivers a @Sigil#name, @affordances, and @invariants to the @LeftHemisphere

!co-occurrence-merge — #merge-sigils wraps @sigils that always appear together into one @sigil

!passive-decay — @sigils not reinforced by #consolidate or #recall lose definition and eventually fail to #recognize-familiar-sigil
