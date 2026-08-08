# MCP Tools Specification

Codebrain MCP exposes **fourteen schema-validated tools** over standard JSON-RPC 2.0 stdio. Every tool strictly validates its arguments with a Zod schema that doubles as its published JSON Schema.

<div class="custom-banner">
  <div class="custom-banner-icon">🛠️</div>
  <div class="custom-banner-content">
    <h4>14 Production MCP Tools</h4>
    <p>11 Read-Only structural query tools and 3 Safe Edit mutation tools designed specifically for AI coding agents.</p>
  </div>
</div>

---

## Tool Category Overview

| Category | Tools | Description |
| :--- | :--- | :--- |
| **Search (2)** | `search_symbols`, `search_code` | Sub-millisecond symbol name lookup and ReDoS-isolated fulltext search. |
| **Navigation (5)** | `get_symbol`, `get_file_structure`, `find_definition`, `find_references`, `get_callers`, `get_callees` | AST hierarchy, callers, callees, definitions, and cross-file references. |
| **Context (1)** | `get_symbol_context` | Comprehensive 360-degree context for a symbol in a single tool call. |
| **Module Graph (2)** | `get_dependencies`, `get_dependents` | Project-wide import/export graph, external npm packages, and barrel files. |
| **Safe Edits (3)** | `apply_patch`, `replace_symbol`, `rename_symbol` | Atomic, verified file modifications with automatic incremental reindexing. |

---

## 1. Search Tools

### `search_symbols`
Finds declarations across the project by name with prioritized exact, prefix, and substring ranking.

**Parameters:**
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | Symbol name or query substring. |
| `match` | `"exact" \| "prefix" \| "substring"` | No | Ranking match strategy (defaults to ranked sequence). |
| `kinds` | `SymbolKind[]` | No | Restrict to specific kinds (`function`, `class`, `interface`, etc.). |
| `languages` | `LanguageId[]` | No | Restrict to `javascript`, `jsx`, `typescript`, or `tsx`. |
| `path_contains` | `string` | No | Substring filter on POSIX file path. |
| `exported_only` | `boolean` | No | Restrict to public module exports. |
| `exclude_ambient` | `boolean` | No | Drop `.d.ts` and ambient declarations. |
| `limit` | `number` | No | Maximum returned symbols (1–500, default: 50). |

---

### `search_code`
Searches file contents for literal strings or regex patterns, annotating every match with its innermost enclosing AST symbol.

**Parameters:**
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | Search pattern or text string. |
| `is_regex` | `boolean` | No | When `true`, evaluates query as regular expression. |
| `case_sensitive` | `boolean` | No | Case sensitivity flag (default: `false`). |
| `languages` | `LanguageId[]` | No | Filter by file languages. |
| `path_contains` | `string` | No | Substring path filter. |
| `limit` | `number` | No | Total match limit (1–500, default: 100). |
| `max_matches_per_file` | `number` | No | Max matches per individual file. |
| `context_lines` | `number` | No | Number of surrounding lines to return (0–10). |
| `time_budget_ms` | `number` | No | Worker execution timeout (default: 500ms). |

---

## 2. Navigation & Context Tools

### `get_symbol`
Retrieves full metadata for a given symbol ID.

```json
// Example Response:
{
  "id": "src/services/user.ts#class:UserService",
  "name": "UserService",
  "kind": "class",
  "file_path": "src/services/user.ts",
  "start_line": 14,
  "end_line": 86,
  "signature": "export class UserService implements IUserService",
  "export_kind": "named"
}
```

---

### `get_symbol_context`
Provides a complete 360-degree context for a symbol in a single tool call:
- **Declaration:** Location, signature, docstrings.
- **Hierarchy:** Parent class/module and child member methods.
- **Call Graph:** Who calls this symbol (`callers`) and what it invokes (`callees`).
- **References:** Semantic occurrences across the repository.
- **Neighborhood:** Module imports and dependents.

---

### `get_file_structure`
Returns the symbol tree of a file: top-level declarations with their nested member methods and properties.

---

### `find_definition` & `find_references`
- `find_definition`: Exact file path and line coordinates where a symbol is declared.
- `find_references`: All semantic occurrences of a symbol across the project.

---

### `get_callers` & `get_callees`
- `get_callers`: Functions/methods that invoke the target symbol, annotated with confidence (`certain` vs `resolved`).
- `get_callees`: Functions and constructors invoked from inside the symbol body.

---

## 3. Module Graph Tools

### `get_dependencies`
Returns all files and external npm packages imported by a file, categorized by target.

### `get_dependents`
Returns all internal files and re-exporting barrel files (`export * from './mod'`) that import the target file.

---

## 4. Safe Edit Tools

### `apply_patch`
Applies exact ordered string replacements to a file. Refuses patches if the target text does not match or matches more than once.

### `replace_symbol`
Slices directly into a symbol declaration using index-recorded UTF-16 code unit offsets, completely replacing its source.

### `rename_symbol`
Performs atomic, cross-file refactoring: updates the declaration, all resolved reference occurrences, and import/export bindings.
