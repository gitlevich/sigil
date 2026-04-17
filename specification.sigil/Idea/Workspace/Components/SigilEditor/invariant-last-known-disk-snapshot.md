---
status: idea
---

# last-known-disk-snapshot

For every file the editor has open, it holds the content hash of the bytes last read from disk or last written to disk, whichever is later. Every read and every successful write updates this hash atomically with the I/O. An external-change detection compares disk content to this hash, never to mtime alone, never to buffer content.

Violation: the snapshot lags behind the editor's own writes (causing the editor to treat its own save as external); the snapshot is compared against the buffer rather than against disk bytes (defeating the point); a watcher event is acted upon without re-reading and re-hashing disk content.
