---
layout: home

hero:
  name: Chanakya MCP
  text: Structural Intelligence — Not AI Guesswork
  tagline: Pure compiler-grade AST static analysis and relational SQLite indexing for AI coding agents. Zero embeddings, zero LLM hallucinations, and zero network calls.
  image:
    src: /logo.svg
    alt: Chanakya MCP Logo
  actions:
    - theme: brand
      text: Quickstart Guide
      link: /guide/getting-started
    - theme: alt
      text: Explore 14 MCP Tools
      link: /reference/mcp-tools
    - theme: alt
      text: View Benchmarks (95% ↓)
      link: /guide/benchmarks

features:
  - title: Pure Structural Intelligence (Not AI)
    details: Built on native Tree-Sitter AST parsing and SQLite relational graphs. Zero probabilistic guessing, zero embeddings, and zero hallucinations.
  - title: 95% Token Reduction
    details: Coding agents receive small, structured, exact answers in ~0.05ms instead of burning thousands of context tokens reading entire raw files.
  - title: Atomic Safe Edits
    details: apply_patch, replace_symbol, and rename_symbol write at exact index-recorded offsets, enforce path containment, and refuse stale content drift.
  - title: Zero Network Calls (100% Local)
    details: Everything executes entirely on your workstation. No source code leaves your machine, and no external AI or embedding APIs are ever used.
  - title: ReDoS-Guarded Search Engine
    details: Tri-tier symbol ranking plus worker-thread regex execution with strict time budgets, bounding backtracking regexes without hanging the server.
  - title: Standard MCP Stdio Protocol
    details: Minimal JSON-RPC 2.0 stdio server with fourteen schema-validated tools using Zod, ready for Claude Code, Cursor, Windsurf, Roo Code, and Cline.
---

<HeroStars />

<div style="text-align: center; margin: 1.5rem 0 0.5rem;">
  <div class="green-highlight-badge">
    <span class="pulsing-green-dot"></span>
    <span class="green-glow-text">Zero network calls</span> &bull; 100% Deterministic Structural Intelligence (Not AI)
  </div>
</div>

<div class="custom-banner">
  <div class="custom-banner-icon">⚡</div>
  <div class="custom-banner-content">
    <h4>Deterministic Structural Code Intelligence — Not AI Guesswork</h4>
    <p>Chanakya MCP does not guess, hallucinate, or generate probabilistic embeddings. It compiles concrete syntax trees (AST) into high-speed SQLite relational graphs with <span class="green-glow-text">Zero network calls</span>.</p>
  </div>
</div>

## Why AI Agents Need Structural Intelligence (Not More Grep or Embeddings)

Coding agents traditionally explore codebases by running `grep` and reading entire source files. Vector embeddings and fuzzy semantic search often return irrelevant approximate matches with zero syntactic guarantees.

Chanakya MCP provides **deterministic AST structural intelligence**: exact symbol declarations, verified call graphs, and relational imports/exports.

<div class="doc-image-card">
  <img src="/mcp-protocol-flow.svg" alt="Chanakya MCP vs Traditional Grep Token Comparison" />
  <div class="doc-image-caption">Comparison: Structured AST query (400 tokens) vs Naive Grep + File Reads (4,500+ tokens)</div>
</div>

| Capability | Without Chanakya (Grep / Embeddings) | With Chanakya MCP (Structural AST) | Advantage |
| :--- | :--- | :--- | :--- |
| **Intelligence Model** | Probabilistic guesswork / Vector embeddings | **100% Deterministic Syntax Trees (AST)** | **Zero Hallucination** |
| **Network & Telemetry**| Cloud embeddings / Remote API calls | <span class="green-pill-bold">Zero network calls</span> (100% Local) | **Zero Data Leak** |
| **Find Symbol Definition** | 3,500 tokens (grep matches + file reads) | 120 tokens | **96% Token Savings** |
| **Find All Semantic References** | 4,500 tokens (scans 15-30 files) | 400 tokens | **91% Token Savings** |
| **Cross-Package Impact Analysis** | 8,000+ tokens (multiple reads) | 550 tokens | **93% Token Savings** |
| **Query Latency** | 2,000 - 5,000 ms (disk I/O) | 150 - 400 ms | **12x Faster** |
| **Call Graph Precision**| Approximate strings / False positives | Exact AST Call Edges (`certain` & `resolved`) | **100% Accuracy** |

---

## Instant Multi-Agent Setup

Connect Chanakya MCP to your favorite AI coding assistant in seconds over standard stdio:

<AgentTabs />

---

## How It Works: Interactive Execution Animation

Watch how Chanakya MCP executes from the moment an AI agent invokes an MCP tool over standard input/output (`stdio`), to AST parsing, symbol extraction, relational SQLite indexing, and sub-millisecond 360° context delivery:

<McpFlowAnimation />

---

## System Architecture

Chanakya MCP operates as a deterministic compiler-grade pipeline: scanning files with `.gitignore` cascade support, parsing with native Tree-Sitter grammars, extracting language-agnostic code models, and querying a high-speed SQLite relational index.

<div class="doc-image-card">
  <img src="/mcp-execution-animation.svg" alt="Chanakya MCP End-to-End Execution Flow" />
  <div class="doc-image-caption">Complete System Architecture: Tool Calling → Scanner → Tree-Sitter AST → Relational SQLite Store → 360° Context Engine</div>
</div>

---

## Interactive 14 MCP Tools Explorer

Explore all 14 schema-validated tools available to your AI agents:

<ToolPlayground />

---

## Measured Performance Benchmarks

Real-world benchmark measurements on full-stack monorepos comparing naive agent file reading against Chanakya MCP tool calls:

<BenchChart />

---

## Key Guarantees

- **Structural Intelligence, Not AI:** Relationships are derived purely from concrete syntax trees. No AI inference, no embeddings, zero hallucinations.
- **No Guessed Relationships:** Edges carry certainty flags (`certain` for syntax, `resolved` across imports). Missing edges are preferred over hallucinated ones.
- **Path Containment:** All read and write operations are strictly sandboxed within the project root using realpath resolution.
- **Incremental Cache:** 2-stage change detection (mtime + hash) reindexes only modified files in under 20ms.
