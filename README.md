# @aravindh-arumugam/chanakya-mcp

<div align="center">

# Chanakya MCP 🧠⚡
### Deterministic Structural Code Intelligence for AI Agents

[![npm version](https://img.shields.io/npm/v/@aravindh-arumugam/chanakya-mcp?color=38bdf8&style=flat-square)](https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg?style=flat-square)](./LICENSE)
[![Zero Network Calls](https://img.shields.io/badge/Network-Zero%20Calls%20(100%25%20Local)-10b981.svg?style=flat-square)](#privacy--security)
[![Tests Passing](https://img.shields.io/badge/Tests-604%20Passed-38bdf8.svg?style=flat-square)](#testing)

**A high-performance local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that equips AI coding agents (Claude Code, Cursor, Windsurf, Roo Code, Cline) with deep structural AST knowledge of JavaScript and TypeScript codebases.**

[Quickstart](#quickstart) • [Why Structural Intelligence?](#why-structural-intelligence) • [Agent Setup](#ai-agent-setup) • [14 MCP Tools](#14-mcp-tools) • [Benchmarks](#performance--benchmarks) • [Architecture](#architecture)

</div>

---

## Why Structural Intelligence?

Coding agents traditionally explore repositories by running `grep` and reading entire source files. That approach is slow, burns thousands of context tokens on irrelevant boilerplate, and vector embeddings frequently hallucinate approximate matches without syntactic guarantees.

**Chanakya MCP provides 100% deterministic compiler-grade structural intelligence:**

- ⚡ **95% Token Reduction** — Returns exact declarations, call graphs, and references in ~150 tokens instead of dumping 4,500+ tokens of raw files.
- 🚀 **~0.05ms Sub-Millisecond Lookups** — Instant relational queries directly against an embedded SQLite index over standard stdio.
- 🔒 **Zero Network Calls** — Runs 100% locally on your machine. Zero source code leaves your workstation. No OpenAI, Anthropic, or external embedding API keys required.
- 🛡️ **Atomic Safe Edits** — AST-recorded offset replacements (`replace_symbol`, `rename_symbol`, `apply_patch`) that enforce path containment and reject stale file drift.
- 🛡️ **ReDoS Worker Sandboxing** — Regular expression matching runs in an isolated worker thread with strict execution time budgets, preventing backtracking regex locks.

---

## Comparison: Grep vs Chanakya MCP

| Task / Capability | Without MCP (Grep + Cat) | With Chanakya MCP (AST Index) | Advantage |
| :--- | :--- | :--- | :--- |
| **Intelligence Model** | Fuzzy strings / Probabilistic embeddings | **100% Deterministic Syntax Trees (AST)** | **Zero Hallucinations** |
| **Network & Privacy** | Cloud telemetry / API dependencies | **Zero network calls (100% Local)** | **Air-Gapped Privacy** |
| **Find Symbol Definition** | 3,500 tokens (grep matches + file reads) | 120 tokens | **96% Token Savings** |
| **Find All References** | 4,500 tokens (reads 15–30 files) | 400 tokens | **91% Token Savings** |
| **Cross-Package Impact** | 8,000+ tokens (multiple reads) | 550 tokens | **93% Token Savings** |
| **Query Latency** | 2,000 – 5,000 ms (disk I/O) | 150 – 400 ms | **12x Faster** |
| **Call Graph Precision** | Ambiguous string matches | Exact AST Call Edges (`certain` & `resolved`) | **100% Precision** |

---

## Quickstart

Run directly on any project with `npx` (no installation required):

```bash
npx -y @aravindh-arumugam/chanakya-mcp /path/to/project
```

Or install globally:

```bash
npm install -g @aravindh-arumugam/chanakya-mcp
chanakya-mcp /path/to/project
```

---

## CLI Usage & Options

```bash
# Index current working directory
chanakya-mcp

# Index a specific project or monorepo subpackage
chanakya-mcp /path/to/project

# Continuous watch mode (debounced auto-reindexing on file save)
chanakya-mcp /path/to/project --watch

# Verbose debug diagnostics (logged to stderr)
chanakya-mcp /path/to/project --verbose
```

### CLI Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `[project-path]` | Target directory to index. | `process.cwd()` |
| `-w`, `--watch` | Watches filesystem and incrementally reindexes on change. | `false` |
| `--force` | Ignores cached fingerprints and forces full reindexing. | `false` |
| `--log-level <level>` | Log level: `silent`, `error`, `warn`, `info`, `debug`. | `info` |
| `--verbose` | Shorthand for `--log-level debug`. | `false` |
| `--quiet` | Shorthand for `--log-level error`. | `false` |
| `-h`, `--help` | Display help text and exit. | — |
| `-v`, `--version` | Display current semver version and exit. | — |

> **Protocol Isolation:** `stdout` is strictly reserved for JSON-RPC 2.0 MCP messages. All logs and diagnostics are written to `stderr`.

---

## AI Agent Setup

### 1. Claude Code Setup

**Option A: Quick CLI Add**
```bash
claude mcp add chanakya -- npx -y @aravindh-arumugam/chanakya-mcp /path/to/project
```

**Option B: Project `.mcp.json`**
Add to `.mcp.json` at your project root:
```json
{
  "mcpServers": {
    "chanakya": {
      "command": "node",
      "args": ["./node_modules/@aravindh-arumugam/chanakya-mcp/dist/cli/main.js", "."],
      "type": "stdio"
    }
  }
}
```
Ensure `"chanakya"` is added to `enabledMcpjsonServers` in your `~/.claude/settings.json`.

---

### 2. Cursor Setup

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "chanakya": {
      "command": "npx",
      "args": ["-y", "@aravindh-arumugam/chanakya-mcp", "${workspaceFolder}"]
    }
  }
}
```

---

### 3. Windsurf / Cascade Setup

Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "chanakya": {
      "command": "npx",
      "args": ["-y", "@aravindh-arumugam/chanakya-mcp", "/absolute/path/to/project"]
    }
  }
}
```

---

### 4. Roo Code / Cline Setup

Add to your Cline MCP settings (`cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "chanakya": {
      "command": "npx",
      "args": ["-y", "@aravindh-arumugam/chanakya-mcp", "/path/to/project"],
      "disabled": false,
      "autoApprove": [
        "search_symbols",
        "search_code",
        "get_symbol",
        "get_symbol_context",
        "find_definition",
        "find_references"
      ]
    }
  }
}
```

---

## 14 MCP Tools

Chanakya MCP exposes 14 tools, each validated with a Zod schema that doubles as its JSON Schema specification:

### Read-Only Structural Tools (11)
1. **`search_symbols`** — Tri-tier ranked symbol lookup (`exact` → `prefix` → `substring`) with kind, language, and path filters.
2. **`search_code`** — Fulltext content search annotated with enclosing AST symbols; protected by worker-thread ReDoS timeouts.
3. **`get_symbol`** — Returns full row metadata (kind, lines, signature, container, export kind).
4. **`get_symbol_context`** — Complete 360-degree context in one call: definition, hierarchy, callers, callees, references, and module neighborhood.
5. **`get_file_structure`** — File symbol hierarchy tree with nested member declarations.
6. **`find_definition`** — Exact file path and 1-based line coordinates of a symbol.
7. **`find_references`** — Every semantic occurrence across the repository with enclosing symbol annotations.
8. **`get_callers`** — Functions and methods that invoke the symbol, with syntactic vs resolved confidence.
9. **`get_callees`** — Functions, methods, and constructors invoked from inside the symbol body.
10. **`get_dependencies`** — Internal files and external npm packages imported by a file.
11. **`get_dependents`** — Internal files and re-exporting barrel files that depend on a module.

### Safe Mutation Tools (3)
12. **`apply_patch`** — Sequential exact string replacements. Rejects ambiguous or missing matches to prevent corruption.
13. **`replace_symbol`** — Slices directly over a declaration using index-recorded UTF-16 code unit offsets.
14. **`rename_symbol`** — Atomic cross-file refactoring: renames declarations, resolved references, and barrel re-exports.

---

## Supported Languages & Grammars

Language detection is deterministic and based on file extension:

| Language | Extensions | Grammar | Parser Type |
| :--- | :--- | :--- | :--- |
| **JavaScript** | `.js`, `.mjs`, `.cjs` | `tree-sitter-javascript` | Native N-API Prebuild |
| **JSX** | `.jsx` | `tree-sitter-javascript` | Native N-API Prebuild |
| **TypeScript** | `.ts`, `.mts`, `.cts`, `.d.ts` | `tree-sitter-typescript` | Native N-API Prebuild |
| **TSX** | `.tsx` | `tree-sitter-typescript` (tsx) | Native N-API Prebuild |

- **Zero WASM Lag:** Ships native precompiled binaries across macOS, Linux, and Windows for both x64 and arm64 architectures.
- **Error-Tolerant AST Recovery:** Typo syntax spots are isolated; valid declarations throughout the rest of the file are fully recovered and indexed.
- **Strict Coordinate Normalization:** All locations are 1-based editor coordinates, and string offsets use UTF-16 code units for exact emoji and unicode slicing.

---

## Architecture

```
Project Files on Disk
       ↓
[1] File Scanner & .gitignore Cascade      (src/scanner/)
       ↓
[2] Native Tree-Sitter Parser             (src/parser/)
       ↓
[3] Normalized Code Model & Extraction    (src/model/, src/extract/)
       ↓
[4] Relational SQLite Database Store       (src/store/, src/indexer/)
       ↓
[5] Navigation, Graph & Search Engines    (src/navigation/, src/search/, src/graph/)
       ↓
[6] MCP Stdio Protocol & Safe Edits        (src/mcp/, src/edit/)
       ↓
AI Coding Clients (Claude Code, Cursor, Windsurf, Cline)
```

### Relational SQLite Index (`.code-intelligence/index.db`)
- **Normalized Tables:** `files`, `symbols`, `relationships`, `references`, `imports`, `exports`, `metadata`.
- **String Interning (Schema v4):** 2M+ identifier occurrences collapse into ~55,000 dictionary entries in `reference_names`, shrinking disk usage by 75%.
- **2-Stage Incremental Hashing:** Stage 1 checks size & mtime (18ms); Stage 2 verifies SHA-256 hash.
- **Racily-Clean Timestamp Mitigation:** Guards against filesystem 1-2s timestamp resolution rounding.

---

## Privacy & Security

- 🟢 **Zero Network Calls:** Completely air-gapped local execution.
- 🛡️ **Path Sandboxing:** All file operations are verified with lexical containment and canonical realpath resolution.
- 🛡️ **ReDoS Sandboxing:** User regexes execute in a worker thread with an enforced execution budget (default: 500ms).
- 🛡️ **Parameterized SQL:** All database statements are strictly parameterized, with automatic escaping for `LIKE` wildcards (`%`, `_`, `\`).
- 🛡️ **Stale-Content Guard:** Edits against drifted files are rejected immediately to protect against clobbering concurrent user changes.

---

## Performance & Benchmarks

Measured on a full-stack monorepo (Express API, React Frontend, Shared Types):

```bash
# Reproduce benchmark results locally:
pnpm run bench:sample
```

| Question Scenario | With Chanakya MCP | Without MCP (Grep + Reads) | Token Reduction |
| :--- | :--- | :--- | :--- |
| Where is `create_user` defined? | 119 tokens | 680 tokens | **82.5% ↓** |
| Everything that uses `format_money` | 150 tokens | 569 tokens | **73.7% ↓** |
| Who calls `user_service.create_user`? | 23 tokens | 680 tokens | **96.7% ↓** |
| What does `user_service` depend on? | 167 tokens | 298 tokens | **44.0% ↓** |
| What breaks if I change shared types? | 23 tokens | 1,568 tokens | **98.5% ↓** |
| Full working context for `user_service` | 582 tokens | 1,006 tokens | **42.2% ↓** |
| **Total Context Consumed** | **1,207 tokens** | **5,190 tokens** | **76.7% Net Savings** |

---

## Development & Documentation

```bash
pnpm install
pnpm run build          # Bundle dist/ with tsup
pnpm run check          # Run typecheck + lint + test
pnpm run test           # Run 604 unit & integration tests
pnpm run docs:dev       # Start VitePress documentation server
```

---

## License

[MIT](./LICENSE) © Aravindh Arumugam
