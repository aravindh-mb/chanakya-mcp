# Search & ReDoS Safety

Chanakya MCP provides two high-performance search mechanisms designed for AI coding agents: **`search_symbols`** (relational index search) and **`search_code`** (content search annotated with enclosing AST symbols).

<div class="custom-banner">
  <div class="custom-banner-icon">ðŸ”</div>
  <div class="custom-banner-content">
    <h4>Sub-Millisecond Search Latency</h4>
    <p>Symbol queries execute in ~0.05ms against pre-built SQLite indexes, while full-text searches stream directly through a ReDoS-isolated worker thread.</p>
  </div>
</div>

---

## 1. `search_symbols` â€” Tri-Tier Ranked Symbol Search

`search_symbols` searches declaration names across the indexed codebase. To provide the best relevancy while avoiding expensive scans, queries run in a prioritized 3-tier sequence:

1. **Exact Matches (`name = ?`):** Hits SQLite B-tree index directly in `< 0.05ms`.
2. **Prefix Matches (`name LIKE 'query%'`):** Utilizes index range scans.
3. **Substring Matches (`name LIKE '%query%'`):** Executed only when broader matching is requested.

```typescript
// Sample Agent Tool Call:
call_tool("search_symbols", {
  query: "UserService",
  match: "exact",
  exported_only: true,
  kinds: ["class", "interface"]
});
```

### Supported Filters
- **`kinds`**: Filter by symbol types (`function`, `class`, `interface`, etc.).
- **`languages`**: Restrict to `javascript`, `jsx`, `typescript`, or `tsx`.
- **`path_contains`**: Filter by POSIX path substring (e.g. `apps/api/`).
- **`exported_only`**: Return only public module exports.
- **`exclude_ambient`**: Ignore `.d.ts` and ambient declarations to eliminate ambient noise.

---

## 2. `search_code` â€” Enclosing Symbol Annotation

`search_code` scans file contents on disk. Rather than returning raw disjoint lines, Codebrain annotates every code match with its **innermost enclosing AST symbol**:

```text
src/auth/jwt.ts:42  in method AuthService.validate_token
   const payload = jwt.verify(token, this.secret_key);
```

This single annotation gives AI agents immediate semantic context without requiring them to read the entire surrounding file.

---

## 3. Worker-Thread ReDoS Safety

JavaScript's built-in regular expression engine uses a backtracking algorithm that exhibits exponential time complexity on pathological patterns containing nested quantifiers, such as `(a+)+$` or `(\w*)*`.

```
Pathological Regex: (a+)+$
Against a 30-character non-matching line: 15+ seconds of CPU lockup!
```

### How Codebrain Prevents Server Hangs:

1. **Static Heuristic Rejection:** Known dangerous nested quantifier patterns are rejected upfront before execution.
2. **Worker Thread Isolation:** Regex execution runs in a dedicated Node.js `Worker` thread.
3. **Terminable Time Budget:** A strict timeout budget (default: 500ms) terminates the worker thread if a pathological backtracking loop occurs, stopping the computation immediately.
4. **Resilient Recovery:** The main MCP server catches the timeout, returns a clean `timed_out` response to the AI agent, and creates a fresh worker thread for subsequent queries.

```json
{
  "matches": [],
  "timed_out": true,
  "searched_files": 48
}
```

---

## 4. SQL Parameterization & Escaping

All database queries are executed using strictly parameterized SQL statements. Additionally, user search strings are escaped for SQLite `LIKE` wildcards (`%`, `_`, `\`), ensuring that searching for literal percentage signs or underscores searches for the exact text without triggering unintended table-wide matches.

