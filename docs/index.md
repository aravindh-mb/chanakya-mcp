---
layout: home

hero:
  name: Codebrain MCP
  text: Structural code intelligence for AI agents
  tagline: A local MCP server that gives AI coding agents deep structural knowledge of a JavaScript/TypeScript codebase.
  image:
    src: /logo.svg
    alt: Codebrain MCP
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/aravindh-mb/codebrain-mcp
    - theme: alt
      text: Roadmap
      link: /roadmap

features:
  - title: Structural index
    details: Symbols, references, calls, imports and exports for JS, JSX, TS and TSX, stored in a local SQLite index.
  - title: Symbol-aware search
    details: Exact, prefix and substring symbol search plus full-text code search, every match annotated with its enclosing symbol.
  - title: Safe, exact edits
    details: apply_patch, replace_symbol and rename_symbol write at exact index-recorded offsets and refuse stale or ambiguous edits.
  - title: Fast and local
    details: Everything runs on your machine — no source leaves it, no AI or embedding API required.
  - title: Regex search that cannot hang
    details: User patterns run in a worker thread the time budget can terminate, so a backtracking pattern is bounded, not fatal.
  - title: Simple MCP over stdio
    details: A minimal JSON-RPC 2.0 server with fourteen tools, each validated by a zod schema that doubles as its JSON Schema.
---

## What it does

Coding agents currently explore repositories by grepping and reading whole files. That is slow, imprecise, and
burns context on source the agent does not need. This package builds a local index of your codebase — symbols,
imports, exports, references, call relationships — and exposes it over [MCP](https://modelcontextprotocol.io) so
an agent can ask "where is `UserService` defined?" or "what calls `create_user`?" and get a small, precise
answer.

```bash
npx @codebrain/mcp /path/to/project
```

Everything runs locally. No source code is uploaded anywhere, and no AI or embedding API is required.
