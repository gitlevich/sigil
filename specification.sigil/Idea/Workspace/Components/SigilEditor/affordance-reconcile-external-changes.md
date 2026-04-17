---
status: idea
---

# reconcile-external-changes

A file I have open changes on disk from outside — another process wrote to it, or I edited it on another machine that synced. I want the editor to notice and reconcile without clobbering my unsaved work and without lying to me.

The editor keeps a !last-known-disk-snapshot per open file: the content hash of the last bytes the editor itself read from disk or wrote to disk. An event from the file watcher is only an external change if the file's current content hash differs from the snapshot. Mtime-only events with identical content are silently ignored. The editor's own writes update the snapshot before they hit disk, so they never self-fire.

When a real external change is detected, the editor compares the buffer to the snapshot. If the buffer is clean — bytes equal to the snapshot — the editor adopts the new disk content silently: the buffer replaces to match disk, the snapshot updates, no notification. If the buffer is dirty — bytes diverge from the snapshot — the editor does not touch the buffer. It surfaces a quiet, non-modal banner on the file's tab saying disk has diverged, and presents a three-way merge view in place of the normal editor pane.

The merge is three-way: !last-known-disk-snapshot is the common ancestor (base), my buffer is mine, disk is theirs. Hunks where only mine changed take mine automatically. Hunks where only theirs changed take theirs automatically. Hunks where both diverged from base are conflicts, marked inline with conflict regions I can see and edit directly. Each conflict region has Mine and Theirs buttons that replace the region with that side's bytes; I can also type anything I want into the region to produce a merged result the conflict didn't anticipate. The panel is a single editable document, not a split view — I see the resolution I am producing, with conflicts only where the three-way merge cannot decide.

When all conflict regions are resolved — no conflict markers remain — the editor commits the merged buffer as the new content: write-through to disk, snapshot updates, banner dismisses, normal editing resumes. Unresolved conflicts keep the banner in place; auto-save is paused on this file until resolution is complete.

The invariant `!editor-owns-content` stands: while a buffer is dirty, the editor is authority and no external write replaces content. This affordance narrows the invariant's scope to dirty buffers; clean buffers are not "being edited" in the load-bearing sense and can safely follow disk.

Violation modes to prevent: firing on the editor's own saves, firing on mtime-only touches, firing on atomic-write intermediate events, popping a modal that steals focus, silently discarding unsaved edits, auto-saving an unresolved merge state to disk, requiring the user to pick a winning side when the three-way merge could have decided.
