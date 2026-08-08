# Security & Sandboxing

Codebrain MCP operates under a **Zero-Trust, Zero-Network local model**. It executes on your machine, interacts only with the codebase you choose to open, and exposes structured AST metadata exclusively over local `stdio`.

<div class="custom-banner">
  <div class="custom-banner-icon">🔒</div>
  <div class="custom-banner-content">
    <h4>100% Air-Gapped & Private</h4>
    <p>Zero telemetry, zero cloud dependencies, zero tracking. No OpenAI, Anthropic, or external embedding API keys are ever needed or contacted.</p>
  </div>
</div>

---

## The 5 Layers of Security

| Defense Layer | Mechanism | Security Objective |
| :--- | :--- | :--- |
| **1. Zero-Network Air-Gap** | Local Stdio JSON-RPC | No outbound HTTP/HTTPS requests or telemetry. |
| **2. Path Sandboxing** | Lexical + Realpath Validation | Prevents path traversal out of the workspace root via `..` or symlinks. |
| **3. ReDoS Worker Sandbox** | Worker Thread + Timeout Budget | Prevents regex backtracking CPU locks from crashing the server. |
| **4. Parameterized SQL** | Prepared Statements + Wildcard Escaping | Eliminates SQL injection and unintended table-wide queries. |
| **5. Stale-Content Guard** | 2-Stage Hash + Timestamp Check | Rejects edits against stale files to avoid silent corruption. |

---

## 1. Path Containment & Symlink Sandboxing

Every relative or absolute path passed to an MCP tool is strictly validated:

1. **Lexical Normalization:** Verifies that the path does not contain parent traversal segments (`../`), drive letters on Windows, or root-relative paths.
2. **Canonical Realpath Check:** Resolves symbolic links and junctions against the filesystem to guarantee that the target file does not reside outside the project directory.

::: warning SYMLINKS OUTSIDE PROJECT ROOT
If a symbolic link inside your repository points to `/etc/passwd` or an external directory, Codebrain detects the out-of-bounds target and rejects it immediately.
:::

---

## 2. Worker Thread ReDoS Isolation

User-supplied regular expressions in `search_code` are isolated in a worker thread with an enforced execution time budget (default: 500ms).

If a catastrophic backtracking pattern is encountered:
- The worker thread is terminated immediately.
- The main MCP process remains healthy and responsive.
- A fresh worker thread is spawned for subsequent queries.

---

## 3. Parameterized SQLite & Escaped Queries

All database queries are executed using parameterized prepared statements. Furthermore, special SQLite `LIKE` wildcards (`%`, `_`, `\`) are automatically escaped in user search strings:

```typescript
// A search for "%" searches for the literal character "%",
// preventing accidental full-table scans.
const escaped_query = query.replace(/[%_\\]/g, '\\$&');
```

---

## Security Reporting

If you discover a security vulnerability, please submit a private report via GitHub Security Advisories or open an issue on the repository. Security patches are prioritized and released promptly.
