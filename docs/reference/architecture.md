# System Architecture

Chanakya MCP is engineered around a clean, layered compiler pipeline that decouples native concrete syntax tree (CST) parsers from the higher-level code intelligence and MCP protocols.

<div class="custom-banner">
  <div class="custom-banner-icon">🏛️</div>
  <div class="custom-banner-content">
    <h4>Layered Separation of Concerns</h4>
    <p>Tree-Sitter grammars remain isolated at the parser boundary. The rest of the system operates on language-independent code models and relational SQLite graphs.</p>
  </div>
</div>

---

## Interactive End-to-End Execution Animation

Experience the full lifecycle of a tool call: from the AI agent's JSON-RPC 2.0 stdio request, to AST parsing, symbol extraction, relational SQLite storage, and sub-millisecond 360° context delivery.

<McpFlowAnimation />

---

## The 5-Stage Execution Pipeline

```
[1] AI Agent Tool Call (stdio stdin)
       ↓
[2] Scanner & Native Tree-Sitter AST Parser (src/scanner/, src/parser/)
       ↓
[3] Normalized Code Model & Relation Extraction (src/model/, src/extract/)
       ↓
[4] Relational SQLite Database Store (WAL mode, Schema v4) (src/store/, src/indexer/)
       ↓
[5] Sub-0.05ms Navigation & 360° Context Engine (stdio stdout) (src/context/, src/mcp/)
```

### Stage 1: AI Tool Call & Protocol Routing (`src/mcp/`)
- **Transport:** AI coding clients (Claude Code, Cursor, Windsurf, Roo Code, Cline) launch Chanakya MCP as a local child process communicating over standard input/output (`stdio`).
- **JSON-RPC 2.0:** Tool requests arrive as JSON-RPC messages on `stdin` (e.g., `{"method": "tools/call", "params": {"name": "get_symbol_context", "arguments": {"id": "src/auth/service.ts#method:UserService.authenticate"}}}`).
- **Zod Validation:** Input parameters are checked against strict Zod schemas in `<0.01ms`.
- **Stdio Isolation:** `stdout` is strictly reserved for JSON-RPC messages; all debug logs and progress counters are redirected to `stderr`.

### Stage 2: File Discovery & AST Parsing (`src/scanner/`, `src/parser/`)
- **`.gitignore` Cascade:** Traverses disk honoring nested `.gitignore` rules, ignoring build artifacts (`node_modules`, `dist`, `.git`).
- **2-Stage Incremental Change Detection:**
  1. *Stat check:* Compares file size and modified timestamp (`mtime`) against SQLite records in ~18ms.
  2. *Content SHA-256:* For racily-clean accuracy on rapid edits within 2 seconds. Unchanged files are immediately skipped.
- **Tree-Sitter Grammars:** Native N-API C bindings parse files into concrete syntax trees (CST/AST) in parallel without spawning external CLI processes.

### Stage 3: Symbol & Graph Extraction (`src/extract/`, `src/model/`)
- **AST Visitor:** Traverses syntax trees to extract normalized entities:
  - **Symbols:** Functions, classes, interfaces, methods, types, constants with exact byte and line coordinates.
  - **Containment:** Parent-child nesting (`class UserService` → `method authenticate`).
  - **Call Edges:** Invocation expressions (`authenticate` calls `verifyHash`).
  - **Imports & Exports:** ES module and CommonJS import/export statements.
- **Certainty Tiers:**
  - `certain`: Syntactic relationship inside the file.
  - `resolved`: Cross-file relationship resolved against static module import bindings.

### Stage 4: Relational SQLite Storage (`src/store/`, `src/indexer/`)
- **Location:** Embedded database stored at `<project>/.chanakya/index.db` in SQLite WAL (Write-Ahead Logging) mode.
- **Atomic Transactions:** Changes are committed in a single `BEGIN TRANSACTION ... COMMIT` block.
- **8 Normalized Relational Tables:**
  1. `files` (file metadata, SHA-256 hash, language)
  2. `symbols` (canonical ID, name, kind, file_id, start/end bounds, signature)
  3. `relationships` (from_key, to_key, to_name, kind, confidence)
  4. `reference_names` (interned string dictionary)
  5. `"references"` (all identifier occurrences pointing to `name_key`)
  6. `imports` (module specifiers, resolved paths, imported names)
  7. `exports` (exported names, local bindings, barrel re-exports)
  8. `metadata` (schema version, tool version, indexing timestamp)
- **String Interning (Schema v4):** 2M+ identifier references collapse into ~55K interned dictionary keys, cutting disk footprint by **75%**.
- **B-Tree Indexes:** Indexes on `(name)`, `(from_key)`, `(to_key)`, `(name_key)` ensure zero full-table scans.

### Stage 5: Sub-0.05ms Relational Retrieval (`src/navigation/`, `src/context/`)
- **Parameterized SQL Queries:** Queries execute against SQLite indexes in **~0.03 - 0.05ms**.
- **360° Context Aggregation:** For `get_symbol_context`:
  - Fetches symbol declaration and signature bounds.
  - Finds all direct callers (functions that invoke this symbol).
  - Finds all direct callees (symbols invoked within this function body).
  - Resolves semantic references across the repository.
  - Assembles enclosing module and import dependencies.
- **Response Delivery:** Serializes clean JSON response over `stdout` (e.g. 180 tokens vs 4,800 tokens for raw file reading).

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
