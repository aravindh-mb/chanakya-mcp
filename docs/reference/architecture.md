# Architecture

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

## Modules

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

## Conventions

Two path conventions hold throughout, so that index keys are identical on every operating system:
absolute **native** paths are used for filesystem access, and **POSIX** paths relative to the project
root are used as identifiers in the index and in MCP responses.

A file inside the project has exactly one canonical identity. A symlinked file is reported under its real
path, never the link's, so an alias can neither shadow nor duplicate the real file in the index.

Code conventions: TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`,
`snake_case` naming (enforced by ESLint), no `any`, no silently swallowed errors, errors carry a
machine-readable code and a fix hint, and small modules — no abstraction without a second caller.

**stdout is reserved for the MCP protocol.** All diagnostics go to stderr.

## Phases

The project was built in twenty phases. Phases 1–17 are implemented; phase 15 (semantic search) is
deliberately deferred, and publishing (phase 20) is pending. See [Roadmap](/roadmap).
