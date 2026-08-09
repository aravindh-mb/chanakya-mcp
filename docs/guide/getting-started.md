# Getting Started

**Chanakya MCP** is a high-performance local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides AI coding agents with deep structural AST knowledge of JavaScript and TypeScript projects.

<div class="custom-banner">
  <div class="custom-banner-icon">ðŸš€</div>
  <div class="custom-banner-content">
    <h4>Zero-Configuration Local Intelligence</h4>
    <p>Everything runs on your machine. No source code leaves your local environment, and no external AI or embedding API keys are required.</p>
  </div>
</div>

---

## Installation

Choose your preferred installation method:

::: code-group

```bash [npx (Instant)]
# Run directly without installation
npx -y @aravindh-arumugam/chanakya-mcp /path/to/project
```

```bash [Global Install (npm)]
npm install -g @aravindh-arumugam/chanakya-mcp
chanakya-mcp /path/to/project
```

```bash [pnpm]
pnpm add -g @aravindh-arumugam/chanakya-mcp
chanakya-mcp /path/to/project
```

```bash [Project Dev Dependency]
pnpm add -D @aravindh-arumugam/chanakya-mcp
```

```bash [Docker]
# Pull the pre-built Docker image
docker pull aravindharumugam/chanakya-mcp:latest

# Run with Docker
docker run -v /path/to/project:/workspace aravindharumugam/chanakya-mcp:latest .
```

:::

---

## Connecting to AI Coding Agents

Chanakya MCP communicates over standard JSON-RPC 2.0 via `stdio`. Choose your client below for instant setup instructions:

<AgentTabs />

---

## Command Line Interface (CLI)

The `chanakya-mcp` binary can be executed directly to inspect projects, perform one-off index builds, or run continuous watch mode:

```bash
# Index the current working directory
chanakya-mcp

# Index a specific target repository or monorepo subfolder
chanakya-mcp /path/to/project

# Run in continuous watch mode (auto-reindexes modified files on save)
chanakya-mcp /path/to/project --watch

# Verbose debug diagnostics (logged to stderr)
chanakya-mcp /path/to/project --verbose
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
| **Help & Version** | `-h`, `--help` / `-v`, `--version` | Displays usage instructions or current semver version. | â€” |

::: tip PROTOCOL RESERVATION
`stdout` is strictly reserved for the MCP JSON-RPC protocol. All logs, index progress stats, and diagnostics are written to `stderr` to prevent protocol corruption.
:::

---

## Verification & Health Check

To verify that Chanakya MCP is operating properly, you can test it directly from the terminal or test tool responses:

```bash
# Test indexing on your project
npx @aravindh-arumugam/chanakya-mcp . --verbose
```

You should see a clean indexing summary logged to `stderr`:
```text
[info] Scanning project files... (103 files detected)
[info] Parsing AST and extracting symbols... (655 symbols found)
[info] Building SQLite relational graph in .chanakya/index.db...
[info] Full index completed in 249ms (0 parse errors)
[info] MCP server listening on stdio
```

---

## Docker Usage

Run Chanakya MCP in a containerized environment without installing Node.js or npm:

```bash
# Basic usage - index current directory
docker run -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest .

# Index specific project path
docker run -v /path/to/project:/workspace aravindharumugam/chanakya-mcp:latest /workspace

# Enable watch mode for live reindexing
docker run -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . --watch

# Verbose logging
docker run -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . --verbose
```

### Docker Compose

For easier setup, use Docker Compose:

```yaml
version: '3.8'
services:
  chanakya-mcp:
    image: aravindharumugam/chanakya-mcp:latest
    volumes:
      - ./my-project:/workspace
    working_dir: /workspace
    command: ["."]
```

Run with:
```bash
docker-compose up
```

**Benefits of Docker:**
- ✓ No local Node.js installation required
- ✓ Consistent environment across machines
- ✓ Works on Linux, macOS, and Windows
- ✓ Easy CI/CD integration
- ✓ Isolated from system dependencies

---

## Monorepos & Workspace Support

Chanakya MCP natively indexes full monorepos (Turborepo, Nx, Lerna, pnpm workspaces, and npm/yarn workspaces). It automatically resolves internal package dependencies (`@company/shared`, `@company/ui`) across workspace packages and indexes cross-package reference graphs.

