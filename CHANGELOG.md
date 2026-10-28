# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Reference-name interning (schema v4): every identifier occurrence now points
  into a `reference_names` dictionary, so a large repository's references
  collapse to its distinct-name vocabulary instead of one string row each.
- `index_project` reports a `timings` breakdown (`scan_ms`, `analyze_ms`,
  `write_ms`, `graph_ms`) so slow runs can be diagnosed.
- Real-path containment for edit tools: a symlink or junction inside the
  project that points outside the root can no longer smuggle a read or write
  out of the tree.
- `SECURITY.md` documenting the threat model and what is guarded.
- Security regression tests for path traversal (including the symlink escape),
  SQL/LIKE injection, and literal-vs-regex handling.
- CI workflow running typecheck, lint, tests and the build on Linux, macOS and
  Windows under Node 20 and 22.

## [2.1.3] - 2026-10-28

Includes everything in 2.1.2, which was tagged but not published to npm.

### Added

- `skills/chanakya-mcp`: an agent skill (`SKILL.md` plus tool and setup
  references) that tells an agent which tool answers which question and how
  to rename, edit and check impact safely.

### Changed

- Tool descriptions no longer claim results are always complete.
  `get_callers` and `find_references` now say which calls they cannot
  resolve (untyped values, callbacks, computed names) and that an empty
  result should be confirmed with `search_code` before treating a symbol as
  unused.
- LICENSE copyright now names Aravindh Arumugam.

## [2.1.2] - 2026-10-28

Two answers that were incomplete are now complete. Existing indexes rebuild
once on first run (schema v5).

### Fixed

- `get_callers` missed method calls made through a typed value:
  `service.create_user()` with `service: user_service`, a variable built with
  `new user_service()`, or `this.users.find()` through a typed field or
  constructor parameter property. The receiver's declared type is now
  recorded and followed through its import. Only plainly written types count;
  untyped, destructured, shadowed and rebound-`this` receivers stay
  unresolved. On VS Code's `src/vs/platform` this resolves 18% more calls
  (92,068 → 108,619) with no slower indexing.
- `get_dependents` missed monorepo apps that import a shared package by name
  (`@acme/shared`). Imports of the repository's own workspace packages now
  resolve through their `package.json` (`source`, `types`, `exports`,
  `module`, `main`, then `src/index`), and dependents are followed through
  re-exporting barrels. A file reached through a barrel is listed, with a
  `via` field, only when it imports a name the target itself exports.

### Changed

- The sample benchmark project now has the `package.json` files a real
  workspace has. With complete answers its token saving is 45.4% (was 55.6%).

## [2.1.1] - 2026-10-08

Same changes as 2.1.0, which was held in npm's staging when this was released
and became public later.

Large-repository performance. On VS Code (14,432 files) the first index went
from 21.3 to 3.6 minutes and a one-file reindex from 14.5 to 6.4 seconds, with
identical index contents. Full numbers: `bench/benchmark-report.html`.

### Added

- Parallel analysis: files are parsed on a pool of up to 4 worker threads
  (`index_project({ workers })`, `dist/indexer/analyze_worker.js`), with
  in-process analysis as the fallback. The next batch parses while the
  previous one is written.
- First-index bulk load: an empty index drops its secondary indexes, loads
  every row, and builds them once at the end.

### Changed

- Graph resolution starts from import bindings and reads candidate rows a page
  at a time, instead of loading every unresolved reference into memory. On
  VS Code (14k files) this removed multi-gigabyte memory growth and made a
  one-file reindex faster.
- `relationships(file_id)` and `references(name_key)` indexes widened to
  `(file_id, to_name)` and `(name_key, file_id)`; existing databases are
  upgraded in place on open.
- `search_code` reads files in concurrent windows and skips files whose
  content cannot match a literal query.

### Fixed

- Default (case-insensitive) symbol search scanned every symbol: added a
  `COLLATE NOCASE` name index. Case-sensitive prefix search now uses a range
  the index can seek instead of `substr()`.
- `search_code` could spend its whole time budget reading files on a large
  repository and return no matches.

## [0.1.0] - unreleased

### Added

- Local MCP server exposing structural knowledge of a JavaScript/TypeScript
  codebase over stdio (JSON-RPC 2.0): `initialize`, `tools/list`, `tools/call`.
- Recursive project scanner with `.gitignore` support (including nested and
  negation patterns), skip lists, size limits and symlink safety.
- Tree-sitter parsing for JS, JSX, TS and TSX via native N-API bindings, with
  a normalized, language-independent code model.
- Symbol extraction (functions, classes, methods, interfaces, types, variables,
  constants, enums, modules) with signatures, containment and export kinds.
- SQLite index with per-file cascading deletes, a versioned schema, and
  rebuild-on-version-mismatch.
- Incremental indexing with a two-stage change check (mtime+size, then content
  hash) and a debounced file watcher.
- Symbol and code search with exact/prefix/substring ranking, filters, and
  worker-thread regex safety with a terminable time budget.
- Navigation: `find_definition`, `find_references`, `find_callers`,
  `find_callees`; the module dependency graph; and `get_symbol_context`.
- Safe, symbol-aware edit tools: `apply_patch`, `replace_symbol`,
  `rename_symbol`, each refusing stale-content edits and out-of-root paths.
- CLI with `--watch`, `--force`, log-level and help options.
