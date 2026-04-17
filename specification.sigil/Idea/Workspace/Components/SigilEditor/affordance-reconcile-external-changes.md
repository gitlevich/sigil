---
status: idea
---

# reconcile-external-changes

A file I have open changes on disk from outside — another process wrote to it, or I edited it on another machine that synced. I want the editor to notice and reconcile without clobbering my unsaved work and without lying to me.

The editor keeps a !last-known-disk-snapshot per open file: the content hash of the last bytes the editor itself read from disk or wrote to disk. An event from the file watcher is only an external change if the file's current content hash differs from the snapshot. Mtime-only events with identical content are silently ignored. The editor's own writes update the snapshot before they hit disk, so they never self-fire.

When a real external change is detected, the editor compares the buffer to the snapshot. If the buffer is clean — bytes equal to the snapshot — the editor adopts the new disk content silently: the buffer replaces to match disk, the snapshot updates, no notification. If the buffer is dirty — bytes diverge from the snapshot — the editor does not touch the buffer. It surfaces a quiet, non-modal indicator on that file's tab saying disk has diverged, with an affordance to view the difference or to discard local edits in favor of disk. No popup, no modal, no focus steal.

The invariant `!editor-owns-content` stands: while a buffer is dirty, the editor is authority and no external write replaces content. This affordance narrows the invariant's scope to dirty buffers; clean buffers are not "being edited" in the load-bearing sense and can safely follow disk.

Violation modes to prevent: firing on the editor's own saves, firing on mtime-only touches, firing on atomic-write intermediate events, popping a modal that steals focus, silently discarding unsaved edits.
