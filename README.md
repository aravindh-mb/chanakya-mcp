# @code-intelligence/mcp

A local [MCP](https://modelcontextprotocol.io) server that gives AI coding agents — Claude Code, Cursor,
and any other MCP-compatible client — deep structural knowledge of a JavaScript/TypeScript codebase.

> **Status: early development.** Phases 1–13 of 20 are implemented: package foundation, CLI, project
> scanner, tree-sitter parsing, the normalized code model, symbol extraction, the SQLite index,
> incremental indexing with a file watcher, lexical search, navigation, the module dependency graph,
> the MCP server over stdio, safe + symbol-aware edit tools, and worker-thread regex safety with a
> terminable time budget. See [Roadmap](#roadmap).

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
claude mcp add code-intelligence -- npx -y @code-intelligence/mcp /path/to/project
```

## Cursor setup

Add to `.cursor/mcp.json`:

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

| Language   | Extensions                  | Detected | Parsed | Grammar                      |
| ---------- | --------------------------- | -------- | ------ | ---------------------------- |
| JavaScript | `.js` `.mjs` `.cjs`         | Yes      | Yes    | tree-sitter-javascript       |
| JSX        | `.jsx`                      | Yes      | Yes    | tree-sitter-javascript       |
| TypeScript | `.ts` `.mts` `.cts` `.d.ts` | Yes      | Yes    | tree-sitter-typescript       |
| TSX        | `.tsx`                      | Yes      | Yes    | tree-sitter-typescript (tsx) |

`jsx` maps to the JavaScript grammar because tree-sitter's JavaScript grammar parses JSX natively.
TypeScript is the opposite case: `.ts` and `.tsx` genuinely need different grammars, which is why they
are separate language ids.

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

## Parsing

Parsing uses the **native** tree-sitter bindings, not WASM. They ship N-API prebuilds for macOS, Linux
and Windows on x64 and arm64, so a plain `npx` install compiles nothing and needs no build toolchain, and
they track current grammar releases. (The readily available `.wasm` builds carry older grammars that
mis-parse modern TypeScript such as `accessor` fields.) Only two files import tree-sitter; everything
above them uses the normalized `syntax_node` type, so the backend stays replaceable.

**Parsing is error-tolerant.** A file with a syntax error still produces a usable tree plus a populated
`parse_errors` list — refusing to index a file because of one typo would lose far more than it protects.
Measured on a 650 KB `.d.ts` with 7 unparseable spots, the parser still recovered 265 interfaces, 77 type
aliases and 1,251 property signatures.

Two conventions are fixed at the parser boundary and hold everywhere above it:

- **Positions are 1-based** for both line and column, as editors display them. tree-sitter is 0-based;
  the conversion happens in exactly one place.
- **Offsets are JavaScript string indices** (UTF-16 code units), not byte offsets, so
  `source.slice(start_index, end_index)` is exact even for source containing emoji or accents. This was
  verified against non-ASCII input rather than assumed.

Nodes are wrapped lazily, so inspecting a few nodes in a large file does not materialize the whole tree,
and tree traversal uses an explicit stack so deeply nested source cannot overflow it.

### Known grammar limitations

These are limits of the upstream grammar, not of this package, and they degrade gracefully — the rest of
the file still parses:

- `abstract` used as a _property name_ (`interface x { abstract: boolean }`) fails to parse, because the
  grammar treats it as a reserved modifier. Other contextual keywords may behave the same way.
- Some ambient `export =` forms in `.d.cts` declaration files fail.

Measured on 4,313 real-world files (40.7 MB of source from `node_modules`): 0 hard failures, and 209
files (4.8%) reported at least one syntax issue, essentially all of them `.d.ts` files using the
constructs above.

## The code model

Between the grammar and the index sits a small, language-independent model. It is **not** a unified AST:
it does not try to represent every construct in every language, only the facts an agent asks for.

| Type             | What it records                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| `code_file`      | path, language, size, content hash, package (for monorepos)                      |
| `code_symbol`    | name, kind, location, parent, signature, export kind                             |
| `relationship`   | `contains`, `imports`, `exports`, `calls`, `references`, `extends`, `implements` |
| `code_import`    | specifier, imported/local name, resolved path, internal vs package               |
| `code_export`    | exported name, local name, re-export source                                      |
| `code_reference` | every occurrence of a name, with its enclosing symbol                            |

Symbol kinds: `function`, `class`, `method`, `interface`, `type`, `variable`, `constant`, `enum`, `module`.

Two rules shape everything here:

**Never invent a relationship.** When a call target cannot be resolved, the edge is stored with the name
that was actually written and _no_ target id, rather than pointed at a plausible-looking symbol. Edges
carry a confidence of `certain` (derived from syntax alone) or `resolved` (followed across an import).
There is deliberately no "guessed" level. An agent acting on a fabricated `calls` edge edits the wrong
function, so a missing edge is much cheaper than a wrong one.

**Symbol ids exclude line numbers.** An id is `<file>#<kind>:<container.path>`, for example
`src/user.ts#method:user_service.create_user`. Editing one function therefore does not change the id of
every symbol below it, which is what lets incremental indexing diff a file instead of rewriting it.

## Symbol extraction

Every declaration becomes a symbol with its kind, 1-based location, containment parent, export kind,
ambient flag, and a one-line signature with the body stripped
(`async create_user(u: user): Promise<void>`). Containment produces `contains` edges, the one
relationship kind that is certain from syntax alone.

Three judgement calls are worth stating, because they shape what you get back:

**`const f = () => {}` is recorded as a function, not a constant.** It is the dominant declaration style
in React and modern TypeScript, and someone searching for a function has to find it.

**Function-local data variables are not indexed.** Names like `stack`, `index` or `base` are meaningless
to search for and would bury real results — on this repository, excluding them took the constant count
from 312 to 37. Functions and classes declared inside a function _are_ kept, since a named callable is
worth looking up however it is scoped.

**Nothing is named by guesswork.** A destructuring binding (`const { a, b } = obj`) binds several names
at once, so no symbol is recorded rather than one invented name; the bindings stay visible as references.
Class and interface _properties_ are not symbols either, because the model has no kind for them and
inventing one would be a deviation. `export default function () {}` is recorded under the name `default`,
which is how consumers actually address it.

Measured on 5,033 real files: 121,034 symbols and 48,532 containment edges, 0 extraction failures,
117 files/sec, 154 MB peak heap. Throughput work is deferred to Phase 17.

## The index

`index_project()` walks the project and writes `<project>/.code-intelligence/index.db`. The directory is
created with a `.gitignore` that excludes it, so the index is never committed by accident.

Tables: `files`, `symbols`, `relationships`, `references`, `imports`, `exports`, `metadata`, with indexes
on the lookup paths that matter — symbol name, name+kind, file, parent, and edges in both directions.

Everything derived from a file cascades from its `files` row, so reindexing one file deletes its old
symbols, edges, imports, exports and references and reinserts them in a single transaction. A crash
mid-write leaves the previous state, never a half-updated file, and stale rows cannot be orphaned. Files
are processed one at a time and written in batched transactions, since SQLite fsyncs per commit.

The schema carries a version. On mismatch the index is **rebuilt rather than migrated**: it is derived
data that can always be regenerated from source, so migration code would be a liability with no upside.

A file that fails to parse is recorded and skipped, never fatal — one bad file in a 10,000-file
repository must not cost the other 9,999.

### Measured

Indexing 5,064 real files (including `node_modules`, which is not the normal case):

|                       |                                                 |
| --------------------- | ----------------------------------------------- |
| Full index            | 41 s (123 files/sec), 0 failures                |
| Extracted             | 121,348 symbols, 48,678 relationships           |
| Peak heap             | 57 MB — flat, files are processed one at a time |
| Symbol lookup by name | ~0.02 ms                                        |
| File structure read   | ~0.05 ms                                        |
| Database size         | 147 MB                                          |

The database size is the weak number. Symbol ids embed the full file path and are repeated in
`parent_id` and across five indexes, so long paths cost a lot. Interning paths and using integer row ids
is the obvious fix and belongs to the performance phase; it is recorded here rather than glossed over.

## Incremental indexing

Reindexing does not reparse the project. There is one code path, not a separate "full" and
"incremental" mode — on an empty index every file is simply new — so the rare path cannot rot.

Deciding what changed happens in two stages, because the cheap signal and the trustworthy signal are
different things:

1. **Size and mtime**, with no file reads. A file matching both is skipped outright.
2. **Content hash**, for anything that failed stage one. If the hash matches, the file was touched but
   not edited and the database is left alone.

That split matters because mtime is a poor proxy for content: `git checkout`, `git stash`, a fresh clone
and many editors rewrite mtimes on files whose bytes never changed. Trusting mtime alone would reindex
the world after every branch switch; hashing everything would mean reading every file every time.

There is a third rule that is easy to miss and causes silent staleness without it. A file whose mtime
falls within two seconds of when it was indexed is **never** trusted, even when size and mtime both
match. Filesystem timestamps are coarse — commonly 1s, and 2s on FAT — so a file edited in the same tick
it was read carries an identical mtime, and if the edit also left the size unchanged, nothing in the
fingerprint reveals it. Git calls these entries racily clean and handles them the same way. This was
found by a test, not by reasoning: an edit that changed content while keeping the byte count went
undetected.

Measured on this repository (60 files):

| Run                                    | Time   | Files parsed             |
| -------------------------------------- | ------ | ------------------------ |
| First index                            | 249 ms | 60                       |
| Nothing changed                        | 18 ms  | 0                        |
| One file edited                        | 20 ms  | 1                        |
| Three files touched, content identical | 24 ms  | 3 checked, **0 written** |

### Watching

`code-intelligence-mcp --watch` keeps the index current as you edit. Changes are debounced (300 ms by
default) so that one save, or a formatter sweeping the project, produces a single reindex rather than
dozens. Writes to `.code-intelligence/` are ignored — without that, the indexer's own database write
would trigger a reindex, which would write again, forever.

The watcher re-runs the normal indexing path rather than reimplementing change tracking. Re-walking
directories costs a `stat` per file (18 ms here) while parsing is the expensive part, and reusing the
normal path means the watcher inherits the full ignore rules, including nested `.gitignore` files,
instead of drifting out of step with them.

Watching uses `fs.watch` in recursive mode rather than adding a dependency. That is a real trade:
recursive mode is unavailable on some platform and Node combinations, and where it is, the failure is
reported clearly at startup rather than silently watching nothing.

## Search

Two entry points, both returning locations and signatures — never file contents.

**`search_symbols`** matches symbol names. It runs exact, prefix and substring comparisons as separate
queries in that order, rather than one combined query: `name = ?` and `name LIKE 'q%'` can use the name
index while `LIKE '%q%'` cannot, so the cheap comparisons run first and an exact hit never pays for a
full scan. That ordering is also the ranking. Filters: kind, language, path, exported-only, and
exclude-ambient (to drop `.d.ts` noise).

**`search_code`** searches file contents, reading from disk rather than storing source — the index would
double in size for data already on the filesystem, and go stale the moment a file changed. What the
index _does_ supply is the file list, already filtered by ignore rules, `.gitignore` and size limits, so
a search never wanders into `node_modules` or a minified bundle.

Every code match is annotated with **the symbol whose body encloses it**, innermost first. That is the
part a plain grep cannot give you, and it is often enough to decide without opening the file:

```
src/search/pattern.ts:104  in method find
   // Long lines are the amplifier for catastrophic backtracking, and are
```

Measured on this repository (69 files, 403 symbols): 0.32 ms per symbol search, 6 ms for a full-text
search across every indexed file.

### Regex safety

Regex search is supported, and the limits are worth stating precisely rather than waving at.

JavaScript's regex engine backtracks and has no timeout, so a pattern nesting one unbounded quantifier
inside another — `(a+)+`, `(\w*)*` — takes exponential time. This was **measured, not assumed**:
`(a+)+$` against a _30 character_ line takes 15 seconds, and every extra character roughly doubles it.

That measurement rules out the obvious mitigations. A line-length cap does not help, because the blowup
happens two orders of magnitude below any useful cap. Neither does a wall-clock budget checked between
lines or files, because the engine never yields during a single failing match.

So regex matching runs in a **worker thread**, and the time budget can **terminate** that thread. The
engine cannot be interrupted from the main thread, but terminating the thread is not an interruption —
it stops the whole worker, backtrace and all. A pathological pattern is therefore bounded: the search
stops at the budget and reports `timed_out` instead of hanging the server.

The nested-quantifier family is still **rejected before it runs**, because refusing costs less than a
worker and gives a better error than a timeout. That check is a heuristic and is documented as one: it
catches what gets written by accident, while the worker terminates everything it misses — an overlapping
alternation like `(a|a)+` backtracks just as badly, and it is bounded by the same budget.

Separately, all SQL is parameterised and `LIKE` wildcards in user queries are escaped, so searching for
`%` finds the literal character instead of returning the entire index.

## Module graph

Navigation resolves within a symbol; the graph resolves across modules. **`get_dependencies`** answers
what a file pulls in, and **`get_dependents`** answers what pulls it in — both grouped by target so two
import lines of the same module read as one dependency.

Dependencies are grouped exactly, never fuzzily. An import is a project file only when its specifier
resolved during the graph pass: a package is reported as the bare specifier (`react`), an unresolvable
relative import as the specifier it is (`./style.css`). A re-exporting barrel (`export * from './user'`)
counts as a dependent of its source, because it genuinely depends on it without binding a name.

## Symbol context

The read-only tools answer one question each, so exploring a single symbol can mean several round trips.
**`get_symbol_context`** answers them all at once, keyed by symbol id: the symbol itself, the chain of
parents that contain it and the members it contains, how heavily it is referenced and in how many files,
who calls it and what it calls, and what its file imports and is imported by.

Every list in the result is capped — a symbol referenced from a hundred files does not ship all of them.
A `total` field beside each list states the true count, and the lists are ordered by weight (members by
source order, references and callers by usage), so what a model sees is the important part of the answer,
not a random slice.

## MCP tools

The server exposes fourteen tools, each validating its arguments with a zod schema that doubles as its
JSON Schema `inputSchema`. Eleven are read-only:

`search_symbols` · `search_code` · `get_symbol` · `get_file_structure` · `find_definition` ·
`find_references` · `get_callers` · `get_callees` · `get_dependencies` · `get_dependents` ·
`get_symbol_context`

They wrap the search, navigation, context and graph layers directly. Results carry locations, names and
signatures — never file contents.

**`get_symbol_context`** bundles the above questions into one result keyed by symbol id: what the symbol
is, what contains it and what it contains, how heavily it is referenced and where, who calls it and what
it calls, and what its file imports and is imported by. Every list is capped so one call cannot explode,
and a `total` next to each capped list says how much was left out.

Three edit tools write files and reindex automatically, and each is safe by construction:

- **`apply_patch`** applies exact text replacements in order. An `old_text` that does not match, or
  matches more than once, refuses the whole call rather than guessing.
- **`replace_symbol`** splices new source over a symbol's declaration at the exact source range the index
  recorded — no fuzzy matching.
- **`rename_symbol`** renames a symbol at its declaration, every resolved reference, and the import and
  export bindings that connect it to other files (including re-exports through barrels). Occurrences the
  index could not resolve are left alone.

Edits never escape the project root, and a file whose content drifted from the index since the last run
refuses any edit to it — every edit requires a fresh index. Because the index refreshes on each edit, a
second edit is checked against the state the first one produced.

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
  parser/      tree-sitter integration, normalized syntax nodes
  model/       symbols, relationships, imports/exports/references
  extract/     syntax tree -> symbols and contains edges
  store/       sqlite schema, queries, row mapping
  indexer/     scan -> parse -> extract -> store
  navigation/  find_definition, find_references, find_callers, find_callees
  context/     get_symbol_context
  graph/       get_dependencies, get_dependents
  search/      symbol and text search, regex safety
  edit/        apply_patch, replace_symbol, rename_symbol
  mcp/         stdio server: JSON-RPC protocol, tool registry
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
- The grammar itself has gaps; see [Known grammar limitations](#known-grammar-limitations).

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
| 3     | Tree-sitter parsing       | Done   |
| 4     | Normalized code model     | Done   |
| 5     | Symbol extraction         | Done   |
| 6     | SQLite index              | Done   |
| 7     | Incremental indexing      | Done   |
| 8     | Code search               | Done   |
| 9     | Navigation                | Done   |
| 10    | Relationship graph        | Done   |
| 11    | MCP server                | Done   |
| 12-13 | Safe + symbol-aware edits | Done   |
| 14-17 | Context, semantic, perf   | Next   |
| 18-20 | Security, docs, publish   | Partly (regex worker) |

## License

[MIT](./LICENSE)
