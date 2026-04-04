The index is derived data. The files on disk are the source of truth. The index can be deleted and rebuilt from scratch without losing any information.

This means: never trust the index over the filesystem. If a file exists but has no index entry, index it. If an index entry has no corresponding file, delete the entry. The filesystem always wins.