# Tool reference

Generated from the server's own tool schemas. Arguments marked **required** must be given; the rest are optional.
Symbol ids come from `search_symbols`; paths are POSIX paths relative to the project root.

## Find and understand

### `search_symbols`

Find a function, class, method, type or variable by name. Returns its id (needed by most other tools), kind, file path, line range and signature. Prefer this over grep for locating declarations; the locations are exact, so there is no need to re-read files to confirm them.

| Argument          | Type                                                                                                                  |              |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------- | :----------- |
| `query`           | string                                                                                                                | **required** |
| `match`           | `exact` \| `prefix` \| `substring`                                                                                    |              |
| `case_sensitive`  | boolean                                                                                                               |              |
| `kinds`           | array of `function` \| `class` \| `method` \| `interface` \| `type` \| `variable` \| `constant` \| `enum` \| `module` |              |
| `languages`       | array of `javascript` \| `jsx` \| `typescript` \| `tsx`                                                               |              |
| `path_contains`   | string                                                                                                                |              |
| `exported_only`   | boolean                                                                                                               |              |
| `exclude_ambient` | boolean                                                                                                               |              |
| `limit`           | integer (min 1, max 500)                                                                                              |              |

### `get_symbol_context`

A symbol’s working context in one call: what it is, what contains it and what it contains, how heavily it is used and where, who calls it, what it calls, and what its file imports and is imported by. Every list is capped; totals say how much was left out.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `find_definition`

Exact location of a symbol’s definition: file, line range and signature. Read only that range if you need the body.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `find_references`

Every place a symbol is used that the index resolved to it: the definition and each use, with file, line and enclosing symbol. Use it for impact analysis before refactoring. Uses through untyped values, dynamic property access or strings are not resolved; if the result looks incomplete, check with search_code.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `get_callers`

The functions and methods that call this symbol, with exact locations. Calls resolve through imports and through receivers with a written type (service: UserService). Calls through untyped values, callbacks or computed names are not resolved, so an empty result does not prove a symbol is unused; confirm with search_code.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `get_callees`

The symbols a symbol calls, with where each call happens. Unresolved calls are named honestly.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `get_symbol`

Return the full row for a symbol id: kind, location, parent, signature, export kind.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `id`     | string | **required** |

### `get_file_structure`

Outline of a file: its functions, classes, methods and types with nesting, line ranges and signatures. Use it to understand a file’s shape without reading the whole file.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `path`   | string | **required** |

### `get_dependencies`

The modules a file imports, grouped by target: internal files by path, packages by specifier, plus the names each import binds.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `path`   | string | **required** |

### `get_dependents`

The files that import a module, and the barrels that re-export from it.

| Argument | Type   |              |
| :------- | :----- | :----------- |
| `path`   | string | **required** |

### `search_code`

Search indexed code for text or a regex. Returns each match with file, line, the matching line, and the enclosing symbol. Use it for strings, comments and names the structural tools cannot resolve; the match context usually makes reading the file unnecessary.

| Argument               | Type                                                    |              |
| :--------------------- | :------------------------------------------------------ | :----------- |
| `query`                | string                                                  | **required** |
| `is_regex`             | boolean                                                 |              |
| `case_sensitive`       | boolean                                                 |              |
| `languages`            | array of `javascript` \| `jsx` \| `typescript` \| `tsx` |              |
| `path_contains`        | string                                                  |              |
| `limit`                | integer (min 1, max 500)                                |              |
| `max_matches_per_file` | integer (min 1, max 9007199254740991)                   |              |
| `context_lines`        | integer (min 0, max 10)                                 |              |
| `time_budget_ms`       | integer (max 9007199254740991, > 0)                     |              |

## Edit

### `rename_symbol`

Rename a symbol everywhere the index resolved it: its declaration and every reference, across files. Uses only the new name; a file that drifted from the index refuses the whole rename. Occurrences the index could not resolve are left alone.

| Argument   | Type   |              |
| :--------- | :----- | :----------- |
| `id`       | string | **required** |
| `new_name` | string | **required** |

### `replace_symbol`

Replace a symbol’s whole declaration with new_source, spliced in at the exact source range the index recorded. Supply the complete replacement text for the declaration.

| Argument     | Type   |              |
| :----------- | :----- | :----------- |
| `id`         | string | **required** |
| `new_source` | string | **required** |

### `apply_patch`

Edit a file with exact text replacements. Each edit replaces the first occurrence of old_text in the CURRENT file content with new_text, applied in order; a non-matching or ambiguous old_text refuses the whole call, so a patch cannot silently corrupt. The index refreshes automatically.

| Argument | Type                                         |              |
| :------- | :------------------------------------------- | :----------- |
| `path`   | string                                       | **required** |
| `edits`  | array of objects with `old_text`, `new_text` | **required** |
