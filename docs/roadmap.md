# Production Status & Roadmap

Codebrain MCP is a production-ready, local code intelligence server built for modern AI coding workflows.

<div class="custom-banner">
  <div class="custom-banner-icon">🎯</div>
  <div class="custom-banner-content">
    <h4>Production Complete & Fully Tested</h4>
    <p>All core parsing, relational indexing, safe editing, ReDoS sandboxing, and MCP stdio protocols are implemented and verified with comprehensive unit and integration test suites.</p>
  </div>
</div>

---

## Production Capabilities Matrix

| System Component | Status | Capability Summary |
| :--- | :--- | :--- |
| **CLI & Startup Orchestration** | **Production** | Automatic project detection, `--watch` mode, verbose diagnostics. |
| **Project Scanner & Ignore Cascade**| **Production** | Nested `.gitignore` support, ignore rules, size caps, symlink sandboxing. |
| **Tree-Sitter Parsing Engine** | **Production** | Native N-API bindings for JS, JSX, TS, TSX with error-tolerant recovery. |
| **AST Symbol Extraction** | **Production** | 9 symbol kinds, 7 relationship kinds, stable IDs without line numbers. |
| **SQLite Relational Store** | **Production** | Cascade-deleting transactions, interned reference dictionary (Schema v4). |
| **Incremental File Watcher** | **Production** | 2-stage change detection (mtime + hash), racily-clean protection, debouncing. |
| **ReDoS-Safe Search** | **Production** | Tri-tier ranked symbol search, worker-thread regex execution with time budget. |
| **AST Navigation & Context** | **Production** | Definitions, references, callers, callees, and 360-degree symbol context. |
| **Module Dependency Graph** | **Production** | File dependencies, dependents, npm packages, and re-exporting barrel files. |
| **Safe Atomic Edits** | **Production** | `apply_patch`, `replace_symbol`, `rename_symbol` with drift rejection. |
| **14 MCP Tools & Stdio Protocol** | **Production** | JSON-RPC 2.0 stdio server validated with Zod schemas. |
| **Multi-Client Verification** | **Production** | Tested and verified on Claude Code, Cursor, Windsurf, Roo Code, and Cline. |

---

## Future Roadmap & Extension Points

While the structural AST engine is complete, the following pluggable enhancements are planned for upcoming releases:

- **Pluggable Local Semantic Search:** Optional local embedding integration (e.g. lightweight ONNX embeddings) for natural-language concept searches that run 100% locally without external APIs.
- **Language Server Protocol (LSP) Bridge:** Optional LSP adapter to ingest inferred type information from `tsserver` for projects requiring deep type-check analysis.
- **Python & Rust Grammar Support:** Extending native Tree-Sitter grammars to Python and Rust codebases.
