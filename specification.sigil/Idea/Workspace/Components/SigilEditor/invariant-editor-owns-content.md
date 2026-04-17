while a sigil is being edited — buffer dirty, diverged from !last-known-disk-snapshot — the editor is the authority on that sigil's content. Disk is a projection of the @EditStream. External processes do not replace a dirty buffer. The editor writes outward through the stream.

A clean buffer is not "being edited" in the load-bearing sense. Disk and buffer are two views of the same content, and #reconcile-external-changes may adopt a newer disk version silently. The authority scope of this invariant is dirty buffers only.

Violation: a file reload, watcher event, or background process replaces a dirty buffer; or a popup/modal interrupts the user when the buffer is clean and reconciliation could have been silent.
