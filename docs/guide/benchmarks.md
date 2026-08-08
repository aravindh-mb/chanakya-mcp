# Performance & Token Benchmarks

To accurately measure the real-world value of Codebrain MCP, we ran a series of head-to-head benchmarks comparing standard coding agent workflows with and without the MCP server.

<div class="custom-banner">
  <div class="custom-banner-icon">📊</div>
  <div class="custom-banner-content">
    <h4>Empirical Token & Latency Measurements</h4>
    <p>Measured on a full-stack monorepo (Express backend, React frontend, shared TypeScript package). Median of 11 runs.</p>
  </div>
</div>

---

## Live Benchmark Results

<BenchChart />

---

## Benchmark Methodology

When measuring the efficiency of an AI agent, measuring raw `grep` text output alone is misleading. A list of matched lines (`path:line:text`) does not reveal which match is a **declaration**, which is a **call site**, or which is a **comment string**.

To determine the answer, a standard agent must read the full matched source files. Those files flood the model's context window with thousands of tokens of boilerplate.

### Benchmark Configurations:
1. **With Codebrain MCP:** The agent executes a single targeted MCP tool call (`find_references`, `get_callers`, `get_symbol_context`), receiving structured JSON in 150-400 tokens.
2. **Without MCP (Baseline):** The agent runs ripgrep to locate matches, and then reads the files that matched to inspect the declarations and syntax.

---

## Detailed Data Breakdown

| Question Scenario | With Codebrain MCP | Without MCP (Grep + Reads) | Raw Grep Lines | Files Inspected | Token Reduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Where is `create_user` defined?** | 119 tokens | 680 tokens | 57 | 2 | **82.5% ↓** |
| **Everything that uses `format_money`** | 150 tokens | 569 tokens | 115 | 3 | **73.7% ↓** |
| **Who calls `user_service.create_user`?** | 23 tokens | 680 tokens | 57 | 2 | **96.7% ↓** |
| **What does `user_service` depend on?** | 167 tokens | 298 tokens | — | 1 | **44.0% ↓** |
| **What breaks if I change shared types?** | 23 tokens | 1,568 tokens | 254 | 8 | **98.5% ↓** |
| **Which components use the orders hook?** | 143 tokens | 389 tokens | 88 | 2 | **63.3% ↓** |
| **Full working context for `user_service`** | 582 tokens | 1,006 tokens | — | 4 | **42.2% ↓** |
| **Total Context Consumed** | **1,207 tokens** | **5,190 tokens** | — | — | **76.7% Net Savings** |

---

## Honest Analysis & Limitations

### Where Codebrain MCP Delivers Maximum Value:
- **Cross-Module Refactoring:** When answering *"What breaks if I alter this shared type?"*, the index returns an exact 23-token impact list versus reading 8 full files (1,568 tokens).
- **Call-Graph Inquiries:** Differentiating call sites from method signatures with zero false positives.
- **Large Monorepos:** Codebases with 100+ files where full scans are slow and burn excessive tokens.

### Where Grep is Sufficient:
- **Small Single Files:** For a 1 KB file, structured JSON describing 11 symbols can be slightly larger than reading the raw file directly.
- **Initial First-Time Indexing:** Building the initial SQLite index takes ~250ms on a 100-file project. Once indexed, subsequent lookups run in under 0.05ms.

---

## Reproducing the Benchmark

You can reproduce these benchmark results locally:

::: code-group

```bash [Sample Full-Stack Monorepo]
# Generates live sample-benchmark.json
pnpm run bench:sample
```

```bash [Self-Indexed Benchmark]
# Runs benchmark against the Codebrain codebase
pnpm run bench
```

:::
