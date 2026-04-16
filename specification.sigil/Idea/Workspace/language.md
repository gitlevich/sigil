---
status: implemented
---

# Workspace

The `sigil-name.sigil` directory. The workspace IS the spec being worked on. It is the membrane between the @user and the @DesignPartner: both attend it, but the @DesignPartner lives in it as home, while the @user reaches in from outside through his keyboard, touchpad, and screen. The invariants that follow are held by their co-attention.

@Workspace consists of UI @components, like @SigilEditor or @chat, dedicated to their affordances.

It maintains its !integrity and offers !clear-organization of documents on disk and panels in front of me. It #remembers-its-state across sessions. It always !reflects-disk-state. When the tree deforms, it !deformations-surface-to-attenders — neither of us works in a place that hides its own changes.

I #navigate to any @sigil and all views sync. I see my path via #breadcrumb. I #back to retrace. I #rename and all references update. I #find-references to see where a sigil is used. I #propose-reshape when a change crosses rooms, and decide whether to commit after seeing its blast radius; reshapes are !reshapes-are-atomic. Every mutation hands me a #confirmation I can match against my intention; the Workspace holds !every-mutation-confirmed. I #probe-name-misfit when I want to look at what currently feels off about naming, without waiting to be told. I use #shortcuts to keep my fingers on the keyboard. I #toggle-dark-light-theme to accommodate my tiring vision. I give my workspace an #application-name.

When ready, I #export or #publish.

Once @workspace is opened, it is !locked-for-concurrent-modification by other instances of the application to ensure its !integrity.
