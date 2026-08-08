# Safe & Atomic Code Edits

Codebrain MCP provides three AST-aware edit tools: **`apply_patch`**, **`replace_symbol`**, and **`rename_symbol`**. Each tool enforces strict validation to guarantee safety and prevent unintended code corruption.

<div class="custom-banner">
  <div class="custom-banner-icon">🛡️</div>
  <div class="custom-banner-content">
    <h4>Zero Silent Corruption</h4>
    <p>Edits are strictly atomic and validated. Any ambiguity, stale file content, or path escape immediately aborts the operation with an actionable error.</p>
  </div>
</div>

---

## The 3 Edit Tools

### 1. `apply_patch` — Ordered Exact Replacement
`apply_patch` takes an array of `{ old_text, new_text }` pairs and applies them in strict sequential order to a file.

```typescript
call_tool("apply_patch", {
  path: "src/config/database.ts",
  edits: [
    {
      old_text: "const POOL_SIZE = 10;",
      new_text: "const POOL_SIZE = 25;"
    }
  ]
});
```

- **Single Match Guarantee:** If `old_text` matches 0 times or more than 1 time in the file, the entire patch is rejected.
- **Automatic Reindexing:** The modified file is automatically re-parsed and its index rows refreshed in SQLite.

---

### 2. `replace_symbol` — AST Range Splicing
`replace_symbol` replaces an entire symbol declaration using the exact UTF-16 code unit offset recorded by the AST index.

```typescript
call_tool("replace_symbol", {
  id: "src/utils/format.ts#function:format_currency",
  new_source: `export function format_currency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}`
});
```

- **Zero Fuzzy Guessing:** Slices directly into the recorded syntax node range.
- **Header & Body Replacement:** Replaces signature, docstrings, and body atomically.

---

### 3. `rename_symbol` — Cross-File Global Renaming
`rename_symbol` renames a symbol at its declaration, across every resolved reference in all files, and through re-export barrel files.

```typescript
call_tool("rename_symbol", {
  id: "src/models/user.ts#interface:UserEntity",
  new_name: "UserProfile"
});
```

- **Transaction Integrity:** Modifications to multiple files are coordinated atomically.
- **Safe Reference Scope:** Renames only symbols that resolved with certainty; unresolvable dynamic names are left untouched.

---

## Safety Guarantees & Defenses

### 1. Realpath Containment Sandboxing
Every target path supplied to an edit tool is validated twice:
1. **Lexical Validation:** Rejects parent directory traversal (`..`), absolute paths, or protocol URLs.
2. **Realpath Resolution:** Resolves symbolic links and NTFS junctions to confirm that the real target file resides strictly within the project root directory.

### 2. Stale Content & Drift Rejection
Before modifying any file on disk, Codebrain verifies that the file's current size, modification timestamp, and content hash match what is stored in the index.

If a developer edited a file in their IDE while the agent was processing, Codebrain **refuses the edit**, triggers an instant incremental reindex, and reports the drift back to the agent so it can regenerate the edit against fresh code.
