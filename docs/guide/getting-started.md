# Getting Started

## Installation

Run it directly, no install required:

```bash
npx @codebrain/mcp
```

Or install globally:

```bash
npm install -g @codebrain/mcp
codebrain-mcp
```

> Not published to npm yet. To run from source, see [Development](#development).

## Usage

```bash
# index the current directory
codebrain-mcp

# index a specific project
codebrain-mcp /path/to/project

# verbose diagnostics
codebrain-mcp ./apps/api --verbose
```

### Options

| Option                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `[project-path]`      | Project root to index. Defaults to the CWD.              |
| `-h`, `--help`        | Show help and exit.                                      |
| `-v`, `--version`     | Show version and exit.                                   |
| `-w`, `--watch`       | Keep running and reindex changed files.                  |
| `--force`             | Reindex every file, ignoring the change check.           |
| `--log-level <level>` | `silent`, `error`, `warn`, `info` (default), or `debug`. |
| `--verbose`           | Shorthand for `--log-level debug`.                       |
| `--quiet`             | Shorthand for `--log-level error`.                       |
| `--`                  | Treat all following arguments as the project path.       |

Exit codes: `0` success, `1` runtime error, `2` usage error.

## Claude Code setup

The server talks MCP over stdio: index the project, then point Claude at the binary:

```bash
claude mcp add codebrain -- npx -y @codebrain/mcp /path/to/project
```

## Cursor setup

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codebrain": {
      "command": "npx",
      "args": ["-y", "@codebrain/mcp", "/path/to/project"]
    }
  }
}
```

No credentials or API keys are involved in any configuration.

## Development

```bash
pnpm install
pnpm run build      # bundle to dist/ with tsup
pnpm run typecheck  # tsc --noEmit
pnpm run test       # vitest
pnpm run lint       # eslint
pnpm run check      # typecheck + lint + test
```

Run the CLI from source without building:

```bash
node --experimental-strip-types src/cli/main.ts --help
# or, after a build
node dist/cli/main.js /path/to/project
```

### Docs site

```bash
pnpm run docs:dev      # local dev server
pnpm run docs:build    # static build to docs/.vitepress/dist
pnpm run docs:preview  # preview the built site
```
