# MCP Tools

The server exposes fourteen tools, each validating its arguments with a zod schema that doubles as its
JSON Schema `inputSchema`. Eleven are read-only and wrap the search, navigation, context and graph
layers directly. Three edit files and reindex automatically.

Results carry locations, names and signatures — never file contents.

## Read-only tools

### search_symbols

Find symbols by name. Returns id, kind, location and signature for each match, ranked exact then prefix
then substring.

| Argument          | Type                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `query`           | `string` (required)                                               |
| `match`           | `"exact"` \| `"prefix"` \| `"substring"`                          |
| `case_sensitive`  | `boolean`                                                         |
| `kinds`           | `array` of symbol kinds                                           |
| `languages`       | `array` of `"javascript"` \| `"jsx"` \| `"typescript"` \| `"tsx"` |
| `path_contains`   | `string` (substring match against the POSIX path)                 |
| `exported_only`   | `boolean`                                                         |
| `exclude_ambient` | `boolean` (drop `.d.ts` and `declare` symbols)                    |
| `limit`           | `integer` 1–500                                                   |

### search_code

Search file contents for literal text or a regular expression. Every match is annotated with the symbol
that encloses it.

| Argument               | Type                     |
| ---------------------- | ------------------------ |
| `query`                | `string` (required)      |
| `is_regex`             | `boolean`                |
| `case_sensitive`       | `boolean`                |
| `languages`            | `array` of language ids  |
| `path_contains`        | `string`                 |
| `limit`                | `integer` 1–500          |
| `max_matches_per_file` | `integer` (cap per file) |
| `context_lines`        | `integer` 0–10           |
| `time_budget_ms`       | `integer` (positive)     |

### get_symbol

Return the full row for a symbol id: kind, location, parent, signature, export kind.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

### get_file_structure

Return the symbols of a file as a tree: top-level declarations with their members nested beneath them.

| Argument | Type     |
| -------- | -------- |
| `path`   | `string` |

### find_definition

Where a symbol is declared: its file, lines and signature, resolved by symbol id.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

### find_references

Every indexed occurrence of a symbol, definition first: where it is declared and where it is used, with
the enclosing symbol of each use.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

### get_callers

The symbols whose bodies call a symbol, with where each call happens and how confidently it resolved.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

### get_callees

The symbols a symbol calls, with where each call happens. Unresolved calls are named honestly.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

### get_dependencies

The modules a file imports, grouped by target: internal files by path, packages by specifier, plus the
names each import binds.

| Argument | Type     |
| -------- | -------- |
| `path`   | `string` |

### get_dependents

The files that import a module, and the barrels that re-export from it.

| Argument | Type     |
| -------- | -------- |
| `path`   | `string` |

### get_symbol_context

A symbol's working context in one call: what it is, what contains it and what it contains, how heavily
it is used and where, who calls it, what it calls, and what its file imports and is imported by. Every
list is capped; `total` fields say how much was left out.

| Argument | Type     |
| -------- | -------- |
| `id`     | `string` |

## Edit tools

### apply_patch

Edit a file with exact text replacements. Each edit replaces the first occurrence of `old_text` in the
**current** file content with `new_text`, applied in order; a non-matching or ambiguous `old_text`
refuses the whole call, so a patch cannot silently corrupt. The index refreshes automatically.

| Argument | Type                                   |
| -------- | -------------------------------------- |
| `path`   | `string` (project-relative POSIX path) |
| `edits`  | `array` of `{ old_text, new_text }`    |

### replace_symbol

Replace a symbol's whole declaration with `new_source`, spliced in at the exact source range the index
recorded. Supply the complete replacement text for the declaration.

| Argument     | Type     |
| ------------ | -------- |
| `id`         | `string` |
| `new_source` | `string` |

### rename_symbol

Rename a symbol everywhere the index resolved it: its declaration and every reference, across files.
Uses only the new name; a file that drifted from the index refuses the whole rename. Occurrences the
index could not resolve are left alone.

| Argument   | Type     |
| ---------- | -------- |
| `id`       | `string` |
| `new_name` | `string` |

## Error handling

Business failures — a missing symbol id, an unindexed file, a patch that does not apply — are raised as
`tool_error` and reported by the server as a **failed tool result** (`isError: true`), so the text
reaches the model and it can recover. Protocol-level mistakes (malformed JSON, an unknown method, a
schema-invalid argument) are answered with the matching JSON-RPC error code.
