# Getting Started

**Codebrain MCP** is a high-performance local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides AI coding agents with deep structural AST knowledge of JavaScript and TypeScript projects.

<div class="custom-banner">
  <div class="custom-banner-icon">🚀</div>
  <div class="custom-banner-content">
    <h4>Zero-Configuration Local Intelligence</h4>
    <p>Everything runs on your machine. No source code leaves your local environment, and no external AI or embedding API keys are required.</p>
  </div>
</div>

---

## Installation

You can run Codebrain MCP on-demand using `npx`, or install it globally via your preferred package manager:

::: code-group

```bash [npx (Instant)]
# Run directly without installation
npx -y @aravindh-arumugam/codebrain-mcp /path/to/project
```

```bash [Global Install (npm)]
npm install -g @aravindh-arumugam/codebrain-mcp
codebrain-mcp /path/to/project
```

```bash [pnpm]
pnpm add -g @aravindh-arumugam/codebrain-mcp
codebrain-mcp /path/to/project
```

```bash [Project Dev Dependency]
pnpm add -D @aravindh-arumugam/codebrain-mcp
```

:::

---

## Connecting to AI Coding Agents

Codebrain communicates over standard JSON-RPC 2.0 via `stdio`. Choose your client below for instant setup instructions:

<AgentTabs />

---

## Command Line Interface (CLI)

The `codebrain-mcp` binary can be executed directly to inspect projects, perform one-off index builds, or run continuous watch mode:

```bash
# Index the current working directory
codebrain-mcp

# Index a specific target repository or monorepo subfolder
codebrain-mcp /path/to/project

# Run in continuous watch mode (auto-reindexes modified files on save)
codebrain-mcp /path/to/project --watch

# Verbose debug diagnostics (logged to stderr)
codebrain-mcp /path/to/project --verbose
```

### CLI Flags & Arguments

| Option | Flag | Description | Default |
| :--- | :--- | :--- | :--- |
| `[project-path]` | Positional | Root directory of the repository to index. | Current Working Directory (`process.cwd()`) |
| **Watch Mode** | `-w`, `--watch` | Watches the filesystem and debounces incremental reindexes on file change. | `false` |
| **Force Reindex** | `--force` | Ignores cached mtimes and reindexes every discovered file from scratch. | `false` |
| **Log Level** | `--log-level` | Diagnostic logging level: `silent`, `error`, `warn`, `info`, `debug`. | `info` |
| **Verbose** | `--verbose` | Shorthand for `--log-level debug`. | `false` |
| **Quiet** | `--quiet` | Shorthand for `--log-level error`. | `false` |
| **Help & Version** | `-h`, `--help` / `-v`, `--version` | Displays usage instructions or current semver version. | — |

::: tip PROTOCOL RESERVATION
`stdout` is strictly reserved for the MCP JSON-RPC protocol. All logs, index progress stats, and diagnostics are written to `stderr` to prevent protocol corruption.
:::

---

## Verification & Health Check

To verify that Codebrain MCP is operating properly, you can test it directly from the terminal or test tool responses:

```bash
# Test indexing on your project
npx @aravindh-arumugam/codebrain-mcp . --verbose
```

You should see a clean indexing summary logged to `stderr`:
```text
[info] Scanning project files... (103 files detected)
[info] Parsing AST and extracting symbols... (655 symbols found)
[info] Building SQLite relational graph in .code-intelligence/index.db...
[info] Full index completed in 249ms (0 parse errors)
[info] MCP server listening on stdio
```

---

## Monorepos & Workspace Support

Codebrain natively indexes full monorepos (Turborepo, Nx, Lerna, pnpm workspaces, and npm/yarn workspaces). It automatically resolves internal package dependencies (`@company/shared`, `@company/ui`) across workspace packages and indexes cross-package reference graphs.
