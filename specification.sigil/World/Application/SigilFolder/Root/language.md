---
status: implemented
---

# Root

The top of a @SigilFolder hierarchy, like @Application is for this @sigil.

It has a #path on the file system that uniquely identifies its location. 

It contains:

- the @sigil itself, as a hierarchy of @SigilFolders
- a @PrivateSigilFolder, a type of @SigilFolder accessible via #instance-private-state, where both the @user and @DesignPartner keep memories not meant for publishing. 