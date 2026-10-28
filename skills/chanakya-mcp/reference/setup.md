# Installing the Chanakya MCP server

Package: [`@aravindh-arumugam/chanakya-mcp`](https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp) on npm. Requires Node.js 18.18 or newer. Everything runs locally: no API keys, no network calls.

Replace `/absolute/path/to/project` with the project root.

## Claude Code

```bash
claude mcp add chanakya -- npx -y @aravindh-arumugam/chanakya-mcp /absolute/path/to/project
```

## Cursor, Windsurf, Gemini CLI, Cline, Roo Code

All use the same `mcpServers` block:

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

| Agent            | Config file                                                                |
| :--------------- | :------------------------------------------------------------------------- |
| Cursor           | `.cursor/mcp.json` in the project (the path can be `"${workspaceFolder}"`) |
| Windsurf         | `~/.codeium/windsurf/mcp_config.json`                                      |
| Gemini CLI       | `~/.gemini/settings.json`                                                  |
| Cline / Roo Code | the extension's MCP settings file                                          |

Restart the agent, or reload its MCP servers, after editing the config.

## First run

The first run builds the index in `.code-intelligence/` inside the project (it adds its own `.gitignore`). That takes seconds for most projects and a few minutes for very large monorepos. On a big repository, run it once in a terminal first so the index is ready when the agent starts:

```bash
npx -y @aravindh-arumugam/chanakya-mcp /absolute/path/to/project
```

When it prints `serving MCP on stdio`, the index is built; press Ctrl+C. Later runs only reprocess changed files.

## Options

| Option                | Effect                                                                     |
| :-------------------- | :------------------------------------------------------------------------- |
| `-w`, `--watch`       | Keep running and reindex files as they change.                             |
| `--force`             | Reindex every file.                                                        |
| `--log-level <level>` | `silent`, `error`, `warn`, `info` (default) or `debug`. Logs go to stderr. |

## Troubleshooting

- **Tools do not appear:** check the config path for your agent, that `npx` is on the agent's PATH, and restart the agent.
- **Results look stale:** the server reindexes changed files on start; run with `--watch` while editing, or restart it.
- **Install fails on native modules:** the package uses `better-sqlite3` and `tree-sitter` native builds. Use an LTS Node version (20 or 22).
