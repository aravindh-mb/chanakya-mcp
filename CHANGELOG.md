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
