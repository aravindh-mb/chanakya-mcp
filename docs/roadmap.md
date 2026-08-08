# Roadmap

| Phase | Scope                     | Status                         |
| ----- | ------------------------- | ------------------------------ |
| 1     | Project foundation + CLI  | Done                           |
| 2     | Project scanner           | Done                           |
| 3     | Tree-sitter parsing       | Done                           |
| 4     | Normalized code model     | Done                           |
| 5     | Symbol extraction         | Done                           |
| 6     | SQLite index              | Done                           |
| 7     | Incremental indexing      | Done                           |
| 8     | Code search               | Done                           |
| 9     | Navigation                | Done                           |
| 10    | Relationship graph        | Done                           |
| 11    | MCP server                | Done                           |
| 12-13 | Safe + symbol-aware edits | Done                           |
| 14    | Symbol context            | Done                           |
| 15    | Semantic search           | Deferred (optional)            |
| 16-17 | Performance               | Done                           |
| 18-20 | Security, docs, publish   | Security done; publish pending |

## Remaining

- **Publishing** — the package is not yet on npm. `npm publish` will be run once the API settles; CI
  and package contents are already verified.
- **Semantic search (Phase 15)** — deliberately deferred until the language-level system is solid. If
  it lands, it will be strictly optional and pluggable, including fully local providers. Nothing
  leaves the machine, and no AI or embedding API is required for the structural features above.
