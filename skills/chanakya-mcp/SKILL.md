---
name: chanakya-mcp
description: Navigate JavaScript and TypeScript codebases through the Chanakya MCP server instead of grep and whole-file reads. Use when finding where a function, class or type is defined; who calls it; every place it is used; what a file imports or what imports it; what breaks if something changes; or before renaming or editing a symbol. Covers installing the server, choosing the right tool for each question, and safe edit workflows. JS/TS projects only (.js, .jsx, .mjs, .cjs, .ts, .tsx, .mts, .cts).
---

# Chanakya MCP: structural code navigation

Chanakya is a local MCP server that indexes a JS/TS project with tree-sitter and answers structural questions in one call: definitions, callers, references, imports and dependents. One tool call usually replaces a grep plus several file reads, and costs far fewer tokens.

## 1. Make sure the server is available

Check whether tools named `search_symbols`, `get_callers`, `get_symbol_context` (often prefixed, e.g. `mcp__chanakya__search_symbols`) are available.

If they are not, the server needs installing. Tell the user, and give them the setup for their agent from `reference/setup.md`. For Claude Code it is one command:

```bash
claude mcp add chanakya -- npx -y @aravindh-arumugam/chanakya-mcp /absolute/path/to/project
```

Requirements: Node.js 18.18+. The first run indexes the project (seconds for most projects, a few minutes for very large monorepos). Do not install anything without the user's go-ahead.

## 2. Pick the tool by the question

| The question                              | Tool                 | Input                                                               |
| :---------------------------------------- | :------------------- | :------------------------------------------------------------------ |
| Where is `X` defined?                     | `search_symbols`     | `{ "query": "X", "match": "exact" }`                                |
| Find a symbol whose name I only half know | `search_symbols`     | `{ "query": "user", "match": "substring" }`                         |
| Everything about `X` before I change it   | `get_symbol_context` | `{ "id": "<id>" }`                                                  |
| Who calls `X`?                            | `get_callers`        | `{ "id": "<id>" }`                                                  |
| What does `X` call?                       | `get_callees`        | `{ "id": "<id>" }`                                                  |
| Every place `X` is used                   | `find_references`    | `{ "id": "<id>" }`                                                  |
| What does this file import?               | `get_dependencies`   | `{ "path": "src/app.ts" }`                                          |
| What breaks if this file changes?         | `get_dependents`     | `{ "path": "src/types.ts" }`                                        |
| What is in this file?                     | `get_file_structure` | `{ "path": "src/app.ts" }`                                          |
| Text, strings, comments, config keys      | `search_code`        | `{ "query": "TODO" }` or `{ "query": "^export", "is_regex": true }` |

**Ids come from `search_symbols`.** Most tools take a symbol `id` (for example `src/services/user.ts#method:user_service.create_user`). Get it from `search_symbols` first, then pass it on. Never construct an id by hand.

**Paths are relative to the project root**, with forward slashes: `apps/api/src/server.ts`.

Full argument lists for every tool: `reference/tools.md`.

## 3. Workflows

### Understand a symbol before changing it

1. `search_symbols` → take the `id` of the right hit (check `file_path` and `kind`).
2. `get_symbol_context` with that id. It returns the definition, its container and members, callers, callees and its file's imports in one call.
3. Read the actual source only for the lines you are about to change, using the `start_line`/`end_line` it gave you.

### Find what a change breaks

1. For a function or method: `get_callers`, then `find_references` for non-call uses.
2. For a file (types, constants, a shared module): `get_dependents`. In monorepos it follows workspace packages (`@acme/shared`) and re-exporting barrels; entries reached through a barrel carry a `via` field naming the barrel.
3. Report the affected files to the user before editing.

### Rename safely

1. `search_symbols` → `id`.
2. `find_references` to see the scope of the change and tell the user how many files are affected.
3. `rename_symbol` with `{ "id": "<id>", "new_name": "..." }`. It changes the declaration and every resolved reference across files, and refuses if any file changed since it was indexed.
4. Then `search_code` for the old name to catch what static analysis cannot see: strings, dynamic property access, docs.

### Edit code

- Whole declaration: `replace_symbol` with the complete new source of the declaration.
- Small change: `apply_patch` with exact `old_text` → `new_text` pairs. It refuses ambiguous or missing matches instead of guessing, so read the current lines first and copy `old_text` exactly.
- Both refresh the index automatically. Edits are confined to the project folder.

## 4. How far to trust the answers

The index never guesses. That makes positive answers reliable, and means an empty answer can sometimes be incomplete:

- **Resolved results are reliable.** A caller or reference with a target symbol was matched through syntax, imports and declared types. You do not need to grep to confirm it.
- **Calls through untyped values are not resolved.** `obj.run()` where `obj` has no written type, callbacks, `obj[key]()`, dependency-injection containers and `eval` stay unresolved by design. `get_callees` lists them by name with no target.
- **When `get_callers` or `find_references` comes back empty** for something the user expects to be used, run `search_code` for the name before concluding it is unused, and say which tool found what.
- **Never delete code as "unused" on an empty result alone.** Confirm with `search_code`, and ask the user.
- **JS and TS only.** For other languages, or files the project ignores (`.gitignore`, `node_modules`, build output), fall back to normal search.

## 5. Keep answers small

- Ask for what you need: `get_callers` instead of `get_symbol_context` when only callers matter, and `limit` on `search_symbols` and `search_code`.
- Do not re-read whole files to "double check" a resolved location. Read only the line range you will change.
- If a result is capped (`truncated: true`), narrow it with `path_contains`, `kinds` or `languages` instead of raising limits.
