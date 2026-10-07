<div align="center">

<img src="https://chanakyamcp.vercel.app/logo.svg" alt="Chanakya MCP logo" width="96" height="96">

# Chanakya MCP

**Give your AI coding agent a map of your codebase.**

A local MCP server that indexes JavaScript and TypeScript projects, so Claude, Cursor, Gemini and other agents can find definitions, callers and dependencies in one call instead of grepping and reading whole files.

[![npm version](https://img.shields.io/npm/v/@aravindh-arumugam/chanakya-mcp?color=38bdf8&style=flat-square)](https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](https://unpkg.com/@aravindh-arumugam/chanakya-mcp/LICENSE)
[![100% local](https://img.shields.io/badge/runs-100%25%20local-10b981?style=flat-square)](#private-by-design)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-38bdf8?style=flat-square)](#requirements)

[Quick start](#quick-start) · [Connect your agent](#connect-your-agent) · [Tools](#tools) · [Benchmarks](#benchmarks) · [Docs](https://chanakyamcp.vercel.app)

</div>

---

## What it does

When an agent needs to know _"who calls `validateUser`?"_, it usually greps, opens a dozen files, and reads them into its context. Chanakya parses your code once with [tree-sitter](https://tree-sitter.github.io/), stores the structure in a local SQLite index, and answers that question directly:

```text
Without Chanakya (example)               With Chanakya
────────────────────────────────         ────────────────────────────────
grep "validateUser"    → 40 matches      get_callers(validateUser)
read routes/user.ts    → 900 tokens        → routes/user.ts:19  registerUserRoutes
read services/user.ts  → 1,100 tokens      → jobs/import.ts:42  importUsers
read jobs/import.ts    → 700 tokens
…sift by hand                            one call, a few dozen tokens
```

## Why use it

- 🎯 **Fewer tokens.** 56–90% less context than grep + file reads in our benchmarks, and the bigger the repo, the bigger the saving.
- ⚡ **Fast.** Most lookups take under 15 ms, even on a 14,000-file repository.
- 🧠 **Structure, not text.** Real definitions, call graphs, references and import graphs from the syntax tree, not fuzzy string matches.
- 🔒 **Private.** Runs entirely on your machine. No API keys, no network calls, no source code leaves your computer.
- ♻️ **Always current.** Incremental reindexing only reparses files that changed; `--watch` keeps it live as you edit.

## Quick start

```bash
npx -y @aravindh-arumugam/chanakya-mcp /path/to/your/project
```

The first run builds the index (seconds for most projects, a few minutes for very large monorepos); later runs only process changed files. The index lives in `.code-intelligence/` inside your project and ignores itself in git.

## Connect your agent

**Claude Code**

```bash
claude mcp add chanakya -- npx -y @aravindh-arumugam/chanakya-mcp /path/to/your/project
```

**Cursor** (`.cursor/mcp.json`), **Windsurf** (`~/.codeium/windsurf/mcp_config.json`), **Gemini CLI** (`~/.gemini/settings.json`), **Cline / Roo Code** (MCP settings): all use the same block.

```json
{
  "mcpServers": {
    "chanakya": {
      "command": "npx",
      "args": ["-y", "@aravindh-arumugam/chanakya-mcp", "/path/to/your/project"]
    }
  }
}
```

In Cursor you can use `"${workspaceFolder}"` as the path.

> **Tip for very large repos:** run the command once in a terminal before connecting your agent, so the first index is already built when the agent starts.

## Tools

**Find and understand**

| Tool                                  | Answers                                                                                  |
| :------------------------------------ | :--------------------------------------------------------------------------------------- |
| `search_symbols`                      | Where is this function, class, type or variable? (exact, prefix or substring)            |
| `get_symbol_context`                  | Everything about a symbol in one call: definition, parents, callers, callees, references |
| `find_definition`                     | Exact file and line of a symbol                                                          |
| `find_references`                     | Every place a symbol is used                                                             |
| `get_callers` / `get_callees`         | Who calls this, and what does it call?                                                   |
| `get_dependencies` / `get_dependents` | What does this file import, and what imports it?                                         |
| `get_file_structure`                  | Outline of a file: classes, methods, functions                                           |
| `get_symbol`                          | Kind, location, signature and export status of a symbol                                  |
| `search_code`                         | Text or regex search, with the enclosing function for every match                        |

**Edit safely**

| Tool             | Does                                                             |
| :--------------- | :--------------------------------------------------------------- |
| `rename_symbol`  | Renames a symbol and its resolved references across files        |
| `replace_symbol` | Replaces a whole declaration by its indexed position             |
| `apply_patch`    | Exact find-and-replace edits; refuses ambiguous or stale matches |

Edits stay inside the project folder and are rejected if the file changed since it was indexed.

## Benchmarks

Measured on Windows 11, Node 24, against the [VS Code](https://github.com/microsoft/vscode) repository (14,432 files) and two smaller projects.

|                                       | Result                          |
| :------------------------------------ | :------------------------------ |
| First index, 14,432 files             | **3.6 min** (21.3 min in 2.0.x) |
| Reindex after editing one file        | **6.4 s**                       |
| Find a definition                     | **~1–12 ms**                    |
| Tokens vs grep + reads, 16-file app   | **56% fewer**                   |
| Tokens vs grep + reads, 126-file repo | **90% fewer**                   |

Numbers come from the benchmark scripts in the source repository (`pnpm run bench`, `pnpm run bench:sample`). Changes behind them are listed in the [changelog](https://unpkg.com/@aravindh-arumugam/chanakya-mcp/CHANGELOG.md).

## Options

```bash
chanakya-mcp [project-path] [options]
```

| Option                         | Description                                             |
| :----------------------------- | :------------------------------------------------------ |
| `[project-path]`               | Project to index. Defaults to the current directory.    |
| `-w, --watch`                  | Keep running and reindex files as they change.          |
| `--force`                      | Reindex every file, ignoring the change check.          |
| `--log-level <level>`          | `silent`, `error`, `warn`, `info` (default) or `debug`. |
| `--verbose` / `--quiet`        | Shorthand for `debug` / `error` logging.                |
| `-h, --help` / `-v, --version` | Show help or version.                                   |

Logs go to stderr; stdout carries only MCP protocol messages.

## Private by design

- Everything runs locally: no network calls, no telemetry, no API keys.
- File access is confined to the project folder, including through symlinks.
- User regexes run in a worker thread with a time limit, so a bad pattern can't hang the server.
- All SQL is parameterized.

See [SECURITY.md](https://unpkg.com/@aravindh-arumugam/chanakya-mcp/SECURITY.md) for the full threat model.

## Requirements

- Node.js 18.18 or newer
- JavaScript or TypeScript projects (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`)

## Links

[Documentation](https://chanakyamcp.vercel.app) · [Changelog](https://unpkg.com/@aravindh-arumugam/chanakya-mcp/CHANGELOG.md) · [MIT License](https://unpkg.com/@aravindh-arumugam/chanakya-mcp/LICENSE) © Aravindh Arumugam
