---
status: wip
---
# Edit

A single edit: a delta to a panel's text, timestamped, with a snapshot of the upstream state at the moment it was written — what the panels above contained when this change happened.

Edits that arrive close together in time belong to the same burst. The burst boundary is determined by the gap distribution of the containing @Edits log, not by a fixed threshold.

The upstream snapshot is what makes an edit meaningful across time. When upstream changes, an edit can be evaluated: does it still hold against the new upstream, or has the ground shifted beneath it?
