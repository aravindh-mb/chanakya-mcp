/**
 * The SQLite schema.
 *
 * The database lives at `<project>/.code-intelligence/index.db` and never
 * leaves the machine. It stores locations, names and signatures — enough to
 * navigate — not file contents.
 *
 * Note on the `references` table: `REFERENCES` is a SQL keyword, so SQLite
 * rejects it as a bare identifier. It is quoted everywhere it appears. The
 * constant below exists so no query has to remember that.
 */

/**
 * Bumped whenever the shape below changes. On mismatch the index is rebuilt
 * from scratch rather than migrated: it is a derived cache that can always be
 * regenerated from source, so carrying migration code would be cost with no
 * benefit.
 *
 * v2 interned the long strings that made v1 huge. File paths stay readable as
 * the public keys the MCP surface passes around, but every other table stores
 * `file_id` (a row in `files`) and symbol `key`/`_key` integers instead of
 * repeating the strings, and the internal `id` columns of relationships,
 * references, imports and exports have become integer rowids.
 *
 * v3 drops the `symbol_ids` dictionary that v2 introduced but never read: the
 * symbol `key` comes straight from `symbols.key`, and cross-file edges resolve
 * their targets by symbol id at write time.
 *
 * v4 interns reference names. Every identifier occurrence is a reference, so
 * on a large repository the same short name repeats millions of times and its
 * string index was the single biggest object in the database. `references`
 * now stores a `name_key` pointing into the `reference_names` dictionary, and
 * queries join back out to the name on read.
 */
export const SCHEMA_VERSION = 4;

/** Quoted because `references` is a reserved word. */
export const REFERENCES_TABLE = '"references"';

export const METADATA_KEYS = {
  schema_version: 'schema_version',
  tool_version: 'tool_version',
  project_root: 'project_root',
  indexed_at: 'indexed_at',
} as const;

export const TABLE_NAMES: readonly string[] = [
  'metadata',
  'files',
  'symbols',
  'relationships',
  'reference_names',
  'references',
  'imports',
  'exports',
];

/**
 * Full schema.
 *
 * `ON DELETE CASCADE` from `files` is what makes incremental reindexing simple
 * in Phase 7: deleting one file row removes every symbol, edge, import, export
 * and reference derived from it, with no chance of orphans left behind.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  file_id           INTEGER PRIMARY KEY,
  file_path         TEXT NOT NULL UNIQUE,
  absolute_path     TEXT NOT NULL,
  language          TEXT NOT NULL,
  size              INTEGER NOT NULL,
  modified_time     INTEGER NOT NULL,
  content_hash      TEXT NOT NULL,
  parse_error_count INTEGER NOT NULL DEFAULT 0,
  package_path      TEXT,
  package_name      TEXT,
  indexed_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  key           INTEGER PRIMARY KEY,
  id            TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  file_id       INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  language      TEXT NOT NULL,
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,
  start_column  INTEGER NOT NULL,
  end_column    INTEGER NOT NULL,
  parent_id     TEXT,
  signature     TEXT,
  export_kind   TEXT NOT NULL,
  is_ambient    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  key        INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  from_key   INTEGER,
  to_key     INTEGER,
  to_name    TEXT NOT NULL,
  confidence TEXT NOT NULL,
  file_id    INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  line       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_names (
  key  INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "references" (
  key                    INTEGER PRIMARY KEY,
  file_id                INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  name_key               INTEGER NOT NULL REFERENCES reference_names(key),
  symbol_key             INTEGER,
  enclosing_symbol_key   INTEGER,
  line                   INTEGER NOT NULL,
  column                 INTEGER NOT NULL,
  is_definition          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  key              INTEGER PRIMARY KEY,
  file_id          INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  module_specifier TEXT NOT NULL,
  imported_name    TEXT,
  local_name       TEXT,
  resolved_path    TEXT,
  is_internal      INTEGER NOT NULL,
  line             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  key             INTEGER PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  exported_name   TEXT NOT NULL,
  local_name      TEXT,
  symbol_key      INTEGER,
  module_specifier TEXT,
  line            INTEGER NOT NULL
);

-- Symbol lookup by name is the hot path: it backs search_symbols,
-- find_definition and find_references.
CREATE INDEX IF NOT EXISTS idx_symbols_name       ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_name_kind  ON symbols(name, kind);
-- Case-insensitive search is the default. A BINARY index cannot serve
-- "name = ? COLLATE NOCASE" or "name LIKE 'q%'", so without this one every
-- default lookup scans the whole table.
CREATE INDEX IF NOT EXISTS idx_symbols_name_nocase ON symbols(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_symbols_file       ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_parent     ON symbols(parent_id);
CREATE INDEX IF NOT EXISTS idx_symbols_kind       ON symbols(kind);

-- Graph traversal walks edges in both directions: callers need to_key,
-- callees need from_key.
CREATE INDEX IF NOT EXISTS idx_rel_from  ON relationships(from_key);
CREATE INDEX IF NOT EXISTS idx_rel_to    ON relationships(to_key);
CREATE INDEX IF NOT EXISTS idx_rel_kind  ON relationships(kind);
CREATE INDEX IF NOT EXISTS idx_rel_name  ON relationships(to_name);
-- (file_id, to_name) rather than file_id alone: it still serves per-file
-- lookups and cascade deletes, and also lets graph resolution seek straight to
-- the edges an import binding can name instead of testing every edge.
DROP INDEX IF EXISTS idx_rel_file;
CREATE INDEX IF NOT EXISTS idx_rel_file_name ON relationships(file_id, to_name);

-- (name_key, file_id) rather than name_key alone, for the same reason: graph
-- resolution looks up "uses of this imported name in this file".
DROP INDEX IF EXISTS idx_refs_name;
CREATE INDEX IF NOT EXISTS idx_refs_name_file ON "references"(name_key, file_id);
CREATE INDEX IF NOT EXISTS idx_refs_symbol ON "references"(symbol_key);
CREATE INDEX IF NOT EXISTS idx_refs_file   ON "references"(file_id);

CREATE INDEX IF NOT EXISTS idx_imports_file     ON imports(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_path);
CREATE INDEX IF NOT EXISTS idx_imports_spec     ON imports(module_specifier);

CREATE INDEX IF NOT EXISTS idx_exports_file   ON exports(file_id);
CREATE INDEX IF NOT EXISTS idx_exports_name   ON exports(exported_name);
CREATE INDEX IF NOT EXISTS idx_exports_symbol ON exports(symbol_key);
`;

/** Used when the stored schema version does not match `SCHEMA_VERSION`. */
export const DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS "references";
DROP TABLE IF EXISTS reference_names;
DROP TABLE IF EXISTS imports;
DROP TABLE IF EXISTS exports;
DROP TABLE IF EXISTS relationships;
DROP TABLE IF EXISTS symbols;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS metadata;
`;
