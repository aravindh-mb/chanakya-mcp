# SQLite Index & Performance

Chanakya MCP compiles the structural AST of your repository into an embedded SQLite database at `<project>/.chanakya/index.db`.

<div class="custom-banner">
  <div class="custom-banner-icon">⚡</div>
  <div class="custom-banner-content">
    <h4>Sub-Millisecond Relational Storage</h4>
    <p>All tables are indexed on primary lookup paths: symbol names, file paths, parent IDs, and relational graph edge targets.</p>
  </div>
</div>

---

## Relational Database Schema

The index is organized into eight optimized relational tables:

| Table | Columns | Purpose |
| :--- | :--- | :--- |
| **`files`** | `path`, `language`, `size`, `mtime`, `hash`, `package` | Primary file registry and change-detection baseline. |
| **`symbols`** | `id`, `file_path`, `name`, `kind`, `start_line`, `end_line`, `signature`, `export_kind` | Core symbol declarations and location bounds. |
| **`relationships`** | `source_id`, `target_id`, `target_name`, `kind`, `confidence` | Graph edges (`contains`, `calls`, `extends`, etc.). |
| **`references`** | `name_id`, `file_path`, `start_line`, `start_col`, `enclosing_symbol_id` | Every semantic identifier occurrence. |
| **`reference_names`**| `id`, `name` | Interned dictionary mapping 2M+ reference strings to integers. |
| **`imports`** | `file_path`, `specifier`, `imported_name`, `local_name`, `resolved_path` | Static module import bindings. |
| **`exports`** | `file_path`, `name`, `local_name`, `source_path`, `is_reexport` | Exported module members and barrel bindings. |
| **`metadata`** | `schema_version`, `indexed_at`, `total_files`, `total_symbols` | Database version and runtime stats. |

---

## Reference String Interning (Schema v4)

On large repositories (e.g. 5,000+ files), storing raw strings for millions of identifier references causes database bloat.

Chanakya MCP implements **reference interning**:
- 2,000,000+ raw references collapse into ~55,000 distinct dictionary entries in `reference_names`.
- Reduces index disk footprint by over **75%**, keeping memory cache hot and query times fast.

---

## 2-Stage Incremental Indexing

Reindexing never re-parses unchanged files:

```
File Modified Event
       ↓
Stage 1: Size & Mtime Check (18ms stat scan)
       ↓ (If mismatch)
Stage 2: Content SHA-256 Hash Verification
       ↓ (If hash changed)
Cascade-delete old file rows & Reinsert in single transaction
```

### Racily-Clean Timestamp Protection
Filesystems have coarse timestamp resolution (1s on ext4, 2s on FAT). If a file is edited within two seconds of being indexed with identical byte count, Chanakya MCP does not trust the mtime alone—it evaluates the content hash to guarantee zero stale data.

---

## Performance Measurements

| Metric | Chanakya MCP Codebase (103 files) | Stress Monorepo (5,123 files) |
| :--- | :--- | :--- |
| **Full Initial Index** | **1.6 seconds** | ~230 seconds |
| **Incremental Reindex** | **18 - 24 ms** | **45 - 80 ms** |
| **Symbol Lookup Latency**| **~0.05 ms** | **~0.08 ms** |
| **Database Size on Disk**| **2.0 MB** | 256 MB (interned) |
| **Extracted Symbols** | 655 symbols | 122,936 symbols |
| **Relational Edges** | 1,840 edges | 370,534 relationships |
