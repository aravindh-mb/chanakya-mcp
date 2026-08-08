---
layout: home

hero:
  name: Codebrain MCP
  text: Structural Code Intelligence for AI Agents
  tagline: A local Model Context Protocol server that gives Claude Code, Cursor, and Windsurf deep structural knowledge of your JavaScript and TypeScript codebases.
  image:
    src: /logo.svg
    alt: Codebrain MCP Logo
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
  - title: Deterministic AST Indexing
    details: Deep structural graph of symbols, references, calls, imports, and exports for JS, JSX, TS, and TSX, stored in an optimized local SQLite index.
  - title: 95% Token Reduction
    details: Coding agents receive small, structured, exact answers in ~0.05ms instead of burning thousands of context tokens reading entire raw files.
  - title: Atomic Safe Edits
    details: apply_patch, replace_symbol, and rename_symbol write at index-recorded offsets, enforce path containment, and refuse stale content drift.
  - title: 100% Local & Zero Telemetry
    details: Everything executes entirely on your workstation. No source code leaves your machine, and no external AI or embedding APIs are required.
  - title: ReDoS-Guarded Search Engine
    details: Tri-tier symbol ranking plus worker-thread regex execution with strict time budgets, bounding backtracking regexes without hanging the server.
  - title: Standard MCP Stdio Protocol
    details: Minimal JSON-RPC 2.0 stdio server with fourteen schema-validated tools using Zod, ready for Claude Code, Cursor, Windsurf, Roo Code, and Cline.
---

<HeroStars />

<div class="custom-banner">
  <div class="custom-banner-icon">⚡</div>
  <div class="custom-banner-content">
    <h4>Production-Ready Local Code Intelligence</h4>
    <p>Eliminate grep noise and token blowups. Codebrain MCP turns full-stack JS/TS codebases into high-speed relational knowledge graphs for AI agents.</p>
  </div>
</div>

## Why AI Agents Need Codebrain MCP

Coding agents traditionally explore codebases by running `grep` and reading entire source files. This process is slow, imprecise, and wastes thousands of precious context window tokens on boilerplate code that the model never needed.

<div class="doc-image-card">
  <img src="/mcp-protocol-flow.svg" alt="Codebrain MCP vs Traditional Grep Token Comparison" />
  <div class="doc-image-caption">Comparison: Structured MCP query (400 tokens) vs Naive Grep + File Reads (4,500+ tokens)</div>
</div>

| Capability | Without Codebrain (Grep + Cat) | With Codebrain MCP | Advantage |
| :--- | :--- | :--- | :--- |
| **Find Symbol Definition** | 3,500 tokens (grep matches + file reads) | 120 tokens | **96% Token Savings** |
| **Find All Semantic References** | 4,500 tokens (scans 15-30 files) | 400 tokens | **91% Token Savings** |
| **Cross-Package Impact Analysis** | 8,000+ tokens (multiple reads) | 550 tokens | **93% Token Savings** |
| **Query Latency** | 2,000 - 5,000 ms (disk I/O) | 150 - 400 ms | **12x Faster** |
| **Result Precision** | High false-positive noise | 100% Exact AST nodes | **Zero Hallucination** |

---

## Instant Multi-Agent Setup

Connect Codebrain MCP to your favorite AI coding assistant in seconds over standard stdio:

<AgentTabs />

---

## System Architecture

Codebrain MCP operates as a multi-tier pipeline: scanning files with `.gitignore` cascade support, parsing with native Tree-Sitter grammars, extracting language-agnostic code models, and querying a high-speed SQLite relational index.

<div class="doc-image-card">
  <img src="/architecture-diagram.svg" alt="Codebrain MCP Architecture Overview" />
  <div class="doc-image-caption">Complete System Architecture: Scanner → Tree-Sitter → Model Extraction → SQLite Index → MCP Engine</div>
</div>

---

## Interactive 14 MCP Tools Explorer

Explore all 14 schema-validated tools available to your AI agents:

<ToolPlayground />

---

## Measured Performance Benchmarks

Real-world benchmark measurements on full-stack monorepos comparing naive agent file reading against Codebrain MCP tool calls:

<BenchChart />

---

## Key Guarantees

- **No Guessed Relationships:** Edges carry certainty flags (`certain` for syntax, `resolved` across imports). Missing edges are preferred over hallucinated ones.
- **Path Containment:** All read and write operations are strictly sandboxed within the project root using realpath resolution.
- **Incremental Cache:** 2-stage change detection (mtime + hash) reindexes only modified files in under 20ms.
