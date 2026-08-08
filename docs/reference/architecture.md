# System Architecture

Codebrain MCP is engineered around a clean, layered pipeline that decouples concrete syntax parsers from the higher-level code intelligence and MCP protocols.

<div class="custom-banner">
  <div class="custom-banner-icon">🏛️</div>
  <div class="custom-banner-content">
    <h4>Layered Separation of Concerns</h4>
    <p>Tree-Sitter grammars remain isolated at the parser boundary. The rest of the system operates on language-independent code models and relational SQL.</p>
  </div>
</div>

---

## Architectural Data Pipeline

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

---

## Source Directory Layout

```text
src/
├── cli/         CLI command parsing, argument flags, help text, startup
├── core/        Errors, structured logger, package metadata, project roots & path containment
├── scanner/     File discovery, .gitignore traversal, language detection
├── parser/      Native Tree-Sitter N-API integration, normalized syntax nodes
├── model/       Language-independent symbols, relationships, imports, exports
├── extract/     AST walking, symbol extraction, contains edges, call detection
├── store/       SQLite database schema, prepared queries, transaction batching
├── indexer/     Orchestration: scan -> parse -> extract -> store + file watcher
├── navigation/  find_definition, find_references, get_callers, get_callees
├── context/     get_symbol_context 360-degree aggregator
├── graph/       get_dependencies, get_dependents
├── search/      Symbol search, fulltext search, worker-thread ReDoS isolation
├── edit/        Safe edits: apply_patch, replace_symbol, rename_symbol
├── mcp/         MCP stdio server: JSON-RPC 2.0 protocol, Zod schemas, tool registry
└── index.ts     Public library API exports
```

---

## Core Engineering Conventions

### 1. Dual Path Representation
- **Native OS Paths:** Used internally for local filesystem I/O (`C:\repo\src\main.ts` or `/home/user/repo/src/main.ts`).
- **Canonical POSIX Paths:** Used for all index IDs, database keys, and MCP responses (`src/main.ts`), guaranteeing identical index behavior across Windows, macOS, and Linux.

### 2. Standard Output Protocol Isolation
`stdout` is strictly reserved for the MCP JSON-RPC protocol. All logs, diagnostics, progress statistics, and debug output are routed to `stderr`.

### 3. Actionable Machine-Readable Errors
All business and validation errors carry a machine-readable `code`, descriptive message, and an actionable `hint` allowing AI agents to self-correct automatically.
