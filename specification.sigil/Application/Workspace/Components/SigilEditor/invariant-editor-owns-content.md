while a sigil is being edited, the editor is the authority on that sigil's content. Disk is a projection of the @EditStream. External processes do not write into the editor. The editor writes outward through the stream.

Violation: a file reload, watcher event, or background process replaces editor content while the user is editing.
