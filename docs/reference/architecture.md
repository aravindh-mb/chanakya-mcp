# System Architecture

Chanakya MCP is engineered around a clean, layered pipeline that decouples concrete syntax parsers from the higher-level code intelligence and MCP protocols.

<div class="custom-banner">
  <div class="custom-banner-icon">ðŸ›ï¸</div>
  <div class="custom-banner-content">
    <h4>Layered Separation of Concerns</h4>
    <p>Tree-Sitter grammars remain isolated at the parser boundary. The rest of the system operates on language-independent code models and relational SQL.</p>
  </div>
</div>

---

## Architectural Data Pipeline

```
Project Files on Disk
       â†“
[1] File Scanner & .gitignore Cascade      (src/scanner/)
       â†“
[2] Native Tree-Sitter Parser             (src/parser/)
       â†“
[3] Normalized Code Model & Extraction    (src/model/, src/extract/)
       â†“
[4] Relational SQLite Database Store       (src/store/, src/indexer/)
       â†“
[5] Navigation, Graph & Search Engines    (src/navigation/, src/search/, src/graph/)
       â†“
[6] MCP Stdio Protocol & Safe Edits        (src/mcp/, src/edit/)
       â†“
AI Coding Clients (Claude Code, Cursor, Windsurf, Cline)
```

---

## Source Directory Layout

```text
src/
â”œâ”€â”€ cli/         CLI command parsing, argument flags, help text, startup
â”œâ”€â”€ core/        Errors, structured logger, package metadata, project roots & path containment
â”œâ”€â”€ scanner/     File discovery, .gitignore traversal, language detection
â”œâ”€â”€ parser/      Native Tree-Sitter N-API integration, normalized syntax nodes
â”œâ”€â”€ model/       Language-independent symbols, relationships, imports, exports
â”œâ”€â”€ extract/     AST walking, symbol extraction, contains edges, call detection
â”œâ”€â”€ store/       SQLite database schema, prepared queries, transaction batching
â”œâ”€â”€ indexer/     Orchestration: scan -> parse -> extract -> store + file watcher
â”œâ”€â”€ navigation/  find_definition, find_references, get_callers, get_callees
â”œâ”€â”€ context/     get_symbol_context 360-degree aggregator
â”œâ”€â”€ graph/       get_dependencies, get_dependents
â”œâ”€â”€ search/      Symbol search, fulltext search, worker-thread ReDoS isolation
â”œâ”€â”€ edit/        Safe edits: apply_patch, replace_symbol, rename_symbol
â”œâ”€â”€ mcp/         MCP stdio server: JSON-RPC 2.0 protocol, Zod schemas, tool registry
â””â”€â”€ index.ts     Public library API exports
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

