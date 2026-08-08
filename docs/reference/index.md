# Index & Performance

`index_project()` walks the project and writes `<project>/.code-intelligence/index.db`. The directory is
created with a `.gitignore` that excludes it, so the index is never committed by accident.

Tables: `files`, `symbols`, `relationships`, `references`, `imports`, `exports`, `metadata`, plus a
`reference_names` dictionary that interns the reference-name column.

Everything derived from a file cascades from its `files` row, so reindexing one file deletes its old
symbols, edges, imports, exports and references and reinserts them in a single transaction. A crash
mid-write leaves the previous state, never a half-updated file, and stale rows cannot be orphaned. Files
are processed one at a time and written in batched transactions, since SQLite fsyncs per commit.

The schema carries a version. On mismatch the index is **rebuilt rather than migrated**: it is derived
data that can always be regenerated from source, so migration code would be a liability with no upside.

A file that fails to parse is recorded and skipped, never fatal — one bad file in a 10,000-file
repository must not cost the other 9,999.

## Incremental indexing

Reindexing does not reparse the project. There is one code path, not a separate "full" and
"incremental" mode — on an empty index every file is simply new — so the rare path cannot rot.

Deciding what changed happens in two stages, because the cheap signal and the trustworthy signal are
different things:

1. **Size and mtime**, with no file reads. A file matching both is skipped outright.
2. **Content hash**, for anything that failed stage one. If the hash matches, the file was touched but
   not edited and the database is left alone.

That split matters because mtime is a poor proxy for content: `git checkout`, `git stash`, a fresh clone
and many editors rewrite mtimes on files whose bytes never changed. Trusting mtime alone would reindex
the world after every branch switch; hashing everything would mean reading every file every time.

There is a third rule that is easy to miss and causes silent staleness without it. A file whose mtime
falls within two seconds of when it was indexed is **never** trusted, even when size and mtime both
match. Filesystem timestamps are coarse — commonly 1s, and 2s on FAT — so a file edited in the same tick
it was read carries an identical mtime, and if the edit also left the size unchanged, nothing in the
fingerprint reveals it. Git calls these entries racily clean and handles them the same way.

## Watching

`code-intelligence-mcp --watch` keeps the index current as you edit. Changes are debounced (300 ms by
default) so that one save, or a formatter sweeping the project, produces a single reindex rather than
dozens. Writes to `.code-intelligence/` are ignored — without that, the indexer's own database write
would trigger a reindex, which would write again, forever.

The watcher re-runs the normal indexing path rather than reimplementing change tracking. Re-walking
directories costs a `stat` per file while parsing is the expensive part, and reusing the normal path
means the watcher inherits the full ignore rules, including nested `.gitignore` files, instead of
drifting out of step with them.

Watching uses `fs.watch` in recursive mode rather than adding a dependency. That is a real trade:
recursive mode is unavailable on some platform and Node combinations, and where it is, the failure is
reported clearly at startup rather than silently watching nothing.

## Measured

On this repository (103 files, 655 symbols), index to first query:

|                       |                   |
| --------------------- | ----------------- |
| Full index            | 1.6 s, 0 failures |
| Database size         | 2.0 MB            |
| Symbol lookup by name | ~0.05 ms          |

The stress case — 5,123 files including `node_modules`, which is not the normal case:

|                   |                                          |
| ----------------- | ---------------------------------------- |
| Full index        | ~230 s (parse + extract dominates)       |
| Extracted         | 122,936 symbols, 370,534 relationships   |
| References stored | 1,995,856 — every identifier occurrence  |
| Database size     | 256 MB (55,655 distinct reference names) |

`index_project` reports a `timings` breakdown (`scan_ms`, `analyze_ms`, `write_ms`, `graph_ms`) so slow
runs can be diagnosed instead of guessed at. On the stress case the split is roughly 1% scan, 80%
parse/extract, 18% writes, 2% graph resolution — tree-sitter parsing, not database work, is the cost.

The database is the derived cache, and its size is dominated by the `references` table (one row per
identifier occurrence) and its indexes. The name column is interned through the `reference_names`
dictionary (schema v4): 2 million references collapse to 55,655 distinct names, which is what keeps the
index from ballooning on repositories with a lot of repetitive code.
