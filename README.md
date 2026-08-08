# @code-intelligence/mcp

A local [MCP](https://modelcontextprotocol.io) server that gives AI coding agents — Claude Code, Cursor,
and any other MCP-compatible client — deep structural knowledge of a JavaScript/TypeScript codebase.

> **Status: early development.** Phases 1–2 of 20 are implemented: package foundation, CLI, and the
> project scanner. Parsing and the MCP server are not implemented yet. See [Roadmap](#roadmap).

## Why this exists

Coding agents currently explore repositories by grepping and reading whole files. That is slow, imprecise,
and burns context on source the agent does not need. This package builds a local index of your codebase —
symbols, imports, exports, references, call relationships — and exposes it over MCP so an agent can ask
"where is `UserService` defined?" or "what calls `create_user`?" and get a small, precise answer.

Everything runs locally. No source code is uploaded anywhere, and no AI or embedding API is required.

## Installation

Run it directly, no install required:

```bash
npx @code-intelligence/mcp
```

Or install globally:

```bash
npm install -g @code-intelligence/mcp
code-intelligence-mcp
```

> Not published to npm yet. See [Development](#development) to run it from source.

## Usage

```bash
# index the current directory
code-intelligence-mcp

# index a specific project
code-intelligence-mcp /path/to/project

# verbose diagnostics
code-intelligence-mcp ./apps/api --verbose
```

### Options

| Option                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `[project-path]`      | Project root to index. Defaults to the CWD.              |
| `-h`, `--help`        | Show help and exit.                                      |
| `-v`, `--version`     | Show version and exit.                                   |
| `--log-level <level>` | `silent`, `error`, `warn`, `info` (default), or `debug`. |
| `--verbose`           | Shorthand for `--log-level debug`.                       |
| `--quiet`             | Shorthand for `--log-level error`.                       |
| `--`                  | Treat all following arguments as the project path.       |

Exit codes: `0` success, `1` runtime error, `2` usage error.

## Claude Code setup

_Available once the MCP server lands (Phase 11)._ The intended configuration:

```bash
claude mcp add code-intelligence -- npx -y @code-intelligence/mcp /path/to/project
```

## Cursor setup

_Available once the MCP server lands (Phase 11)._ Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-intelligence": {
      "command": "npx",
      "args": ["-y", "@code-intelligence/mcp", "/path/to/project"]
    }
  }
}
```

No credentials or API keys are involved in any configuration.

## Supported languages

| Language   | Extensions                  | Detected | Parsed            |
| ---------- | --------------------------- | -------- | ----------------- |
| JavaScript | `.js` `.mjs` `.cjs`         | Yes      | Planned (Phase 3) |
| JSX        | `.jsx`                      | Yes      | Planned (Phase 3) |
| TypeScript | `.ts` `.mts` `.cts` `.d.ts` | Yes      | Planned (Phase 3) |
| TSX        | `.tsx`                      | Yes      | Planned (Phase 3) |

Language is decided by file extension only. Sniffing a `.js` file to guess whether it "really" contains
JSX would be a guess, and this package does not guess — tree-sitter's JavaScript grammar parses JSX anyway.

Framework-specific intelligence (Next.js routes, NestJS modules, Express routers) is deliberately out of
scope until the language-level system is solid.

## What the scanner excludes

Skipped directories by default: `node_modules`, `.git`, `dist`, `build`, `coverage`, `out`, `.next`,
`.nuxt`, `.svelte-kit`, `.output`, `.turbo`, `.cache`, `.parcel-cache`, `.expo`, `.vercel`, `.netlify`,
`.yarn`, `.pnpm-store`, `.code-intelligence`. Skipped file patterns: `*.min.js`, `*.bundle.js`, `*.map`.

`.gitignore` is honoured, including nested `.gitignore` files scoped to their own subtree and negation
patterns. Files over 1 MiB are skipped. Symlinks are **not** followed by default; when enabled they are
re-validated against the project root after resolution, so a link cannot pull in files from outside.

Anything skipped for a reason worth knowing about (too large, symlink, outside root, unreadable, limit
reached) is reported rather than silently dropped. Routine exclusions are not listed individually — on a
large repository that list would dwarf the result.

## MCP tools

Planned tool surface — small and deliberately non-redundant:

`search_symbols` · `search_code` · `get_symbol` · `get_file_structure` · `find_definition` ·
`find_references` · `get_callers` · `get_callees` · `get_dependencies` · `get_dependents` ·
`apply_patch` · `replace_symbol` · `rename_symbol`

None are implemented yet.

## Architecture

```
project files
    -> file scanner            (Phase 2)
    -> language detection      (Phase 2)
    -> tree-sitter parser      (Phase 3)
    -> normalized code model   (Phase 4-5)
    -> sqlite index            (Phase 6-7)
    -> relationship graph      (Phase 10)
    -> search engine           (Phase 8-9)
    -> mcp server              (Phase 11)
    -> claude / cursor / other agents
```

Key design decision: there is **no unified AST**. Each language keeps its own tree-sitter grammar, and a
thin normalization layer maps it into a language-independent code model. Only the normalization layer knows
about tree-sitter; nothing above it does.

Currently implemented:

```
src/
  cli/         argv parsing, help text, CLI orchestration
  core/        errors, logger, package metadata, project root + path containment
  scanner/     file discovery, language detection, ignore rules
  index.ts     public library exports
```

Two path conventions hold throughout, so that index keys are identical on every operating system:
absolute **native** paths are used for filesystem access, and **POSIX** paths relative to the project root
are used as identifiers in the index and in MCP responses.

A file inside the project has exactly one canonical identity. A symlinked file is reported under its real
path, never the link's, so an alias can neither shadow nor duplicate the real file in the index.

## Privacy

- All parsing and indexing happens on your machine.
- The index is written to `.code-intelligence/` inside your project.
- No network calls are made by the core package.
- No OpenAI, Anthropic, Gemini, or embedding API is required or used.
- Semantic search (Phase 15) will be strictly optional and pluggable, including fully local providers.

## Limitations

This is static analysis. It will be honest about what it cannot know:

- Dynamic dispatch, `eval`, and runtime-computed property access cannot be resolved statically.
- Call relationships through higher-order functions or dependency injection containers are often
  undecidable; the indexer records a relationship only when it can determine it confidently.
- Type-level inference is not performed — this is not a TypeScript compiler. Relationships come from
  syntax, not from the type checker.
- Generated code, minified bundles, and very large files are skipped.

No "N% token reduction" claims are made anywhere in this project unless they have been measured.

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

### Conventions

- TypeScript strict mode, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `snake_case` for variables, functions, types, and interfaces (enforced by ESLint).
- No `any`. No silently swallowed errors. Errors carry a machine-readable code and a fix hint.
- Small modules; no abstraction without a second caller.
- **stdout is reserved for the MCP protocol.** All diagnostics go to stderr.

## Testing

```bash
pnpm run test
pnpm run test:coverage
```

Tests live in `tests/`, mirroring the `src/` layout. Fixture repositories (React frontend, Node backend,
shared package) arrive with the parser phases.

## Publishing

```bash
pnpm run check
pnpm run build
npm publish --access public
```

`prepublishOnly` runs the build. Only `dist/`, `README.md`, and `LICENSE` are published.

## Roadmap

| Phase | Scope                     | Status |
| ----- | ------------------------- | ------ |
| 1     | Project foundation + CLI  | Done   |
| 2     | Project scanner           | Done   |
| 3     | Tree-sitter parsing       | Next   |
| 4-5   | Normalized model, symbols | —      |
| 6-7   | SQLite index, incremental | —      |
| 8-10  | Search, navigation, graph | —      |
| 11    | MCP server                | —      |
| 12-13 | Safe + symbol-aware edits | —      |
| 14-17 | Context, semantic, perf   | —      |
| 18-20 | Security, docs, publish   | —      |

## License

[MIT](./LICENSE)
