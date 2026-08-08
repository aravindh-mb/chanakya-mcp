/**
 * The SQLite-backed index.
 *
 * This is the only module that imports better-sqlite3, mirroring how only the
 * parser layer imports tree-sitter. Callers work with model objects and never
 * see a row, a statement or a driver type.
 *
 * The driver is synchronous by design. Indexing is CPU-bound parsing punctuated
 * by writes, and a synchronous driver inside one transaction is both faster and
 * far simpler to reason about than an async one — there is no interleaving to
 * worry about mid-transaction.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as database_handle, Statement } from 'better-sqlite3';
import { code_intelligence_error, describe_unknown_error } from '../core/errors.js';
import type { code_file, file_analysis } from '../model/file.js';
import type { code_symbol } from '../model/symbol.js';
import type { relationship } from '../model/relationship.js';
import type { code_export, code_import, code_reference } from '../model/module_graph.js';
import { DROP_SCHEMA_SQL, METADATA_KEYS, REFERENCES_TABLE, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import {
  to_code_export,
  to_code_file,
  to_code_import,
  to_code_reference,
  to_code_symbol,
  to_relationship,
  to_sql_boolean,
  to_sql_nullable,
  type export_row,
  type file_row,
  type import_row,
  type reference_row,
  type relationship_row,
  type symbol_row,
} from './row_mapping.js';

/** File name of the database inside the project's data directory. */
export const DATABASE_FILE_NAME = 'index.db';

export interface open_index_store_options {
  /** Directory to hold the database, normally `<project>/.code-intelligence`. */
  readonly data_dir_path: string;
  /** Absolute project root, recorded in metadata. */
  readonly project_root: string;
  /** Use an in-memory database. For tests. */
  readonly in_memory?: boolean;
  /** Version string recorded in metadata. */
  readonly tool_version?: string;
}

/** The stored fingerprint of a file, used to decide whether it needs reindexing. */
export interface file_stamp {
  readonly content_hash: string;
  readonly size: number;
  readonly modified_time: number;
  /** When this row was written. Needed to detect racily-clean files. */
  readonly indexed_at: number;
}

/**
 * A SQL fragment plus its bound values.
 *
 * Values are always bound, never interpolated. Everything reaching this layer
 * came from an MCP client, so string-built SQL would be an injection hole.
 */
export interface sql_condition {
  readonly sql: string;
  readonly parameters: readonly string[];
}

export interface symbol_query {
  readonly name_condition: sql_condition;
  readonly kinds?: readonly string[];
  readonly languages?: readonly string[];
  /** Already-escaped `LIKE` pattern for the file path. */
  readonly path_like?: string;
  readonly exported_only?: boolean;
  readonly exclude_ambient?: boolean;
  readonly limit: number;
}

export interface file_query {
  readonly languages?: readonly string[];
  readonly path_like?: string;
}

export interface index_counts {
  readonly files: number;
  readonly symbols: number;
  readonly relationships: number;
  readonly references: number;
  readonly imports: number;
  readonly exports: number;
}

interface prepared_statements {
  readonly insert_file: Statement;
  readonly insert_symbol: Statement;
  readonly insert_relationship: Statement;
  readonly insert_reference: Statement;
  readonly insert_import: Statement;
  readonly insert_export: Statement;
  readonly delete_file: Statement;
  readonly select_file: Statement;
  readonly select_symbol: Statement;
  readonly select_symbols_by_name: Statement;
  readonly select_symbols_by_file: Statement;
  readonly select_relationships_from: Statement;
  readonly select_relationships_to: Statement;
  readonly select_unresolved_calls: Statement;
  readonly select_all_imports: Statement;
  readonly select_all_exports: Statement;
  readonly select_symbols_by_parent: Statement;
  readonly select_file_paths: Statement;
  readonly select_imports_by_file: Statement;
  readonly select_imports_resolved_to: Statement;
  readonly select_exports_by_file: Statement;
  readonly select_references_by_name: Statement;
  readonly select_references_to: Statement;
  readonly select_unresolved_references: Statement;
  readonly select_symbol_key: Statement;
  readonly update_edge_target: Statement;
  readonly update_import_resolved_path: Statement;
  readonly update_reference_target: Statement;
  readonly set_metadata: Statement;
  readonly get_metadata: Statement;
}

export class index_store {
  readonly #db: database_handle;
  readonly #statements: prepared_statements;

  private constructor(db: database_handle) {
    this.#db = db;
    this.#statements = prepare_statements(db);
  }

  static open(options: open_index_store_options): index_store {
    const db = open_database(options);
    const store = new index_store(db);
    store.set_metadata(METADATA_KEYS.project_root, options.project_root);
    if (options.tool_version !== undefined) {
      store.set_metadata(METADATA_KEYS.tool_version, options.tool_version);
    }
    return store;
  }

  /**
   * Replace everything recorded for one file.
   *
   * Deleting the file row first cascades to its symbols, edges, imports,
   * exports and references, so a reindex cannot leave stale rows behind. The
   * whole replacement runs in one transaction: a crash mid-write leaves the
   * previous state, never a half-updated file.
   */
  write_file_analysis(analysis: file_analysis): void {
    this.transaction(() => {
      this.#statements.delete_file.run(analysis.file.file_path);
      const file_id = this.#insert_file(analysis.file);

      const symbol_key_by_id = new Map<string, number>();
      for (const symbol of analysis.symbols) {
        symbol_key_by_id.set(symbol.id, this.#insert_symbol(symbol, file_id));
      }

      const resolve_key = (id: string | undefined): number | null =>
        id === undefined ? null : (symbol_key_by_id.get(id) ?? this.#live_symbol_key(id));

      for (const edge of analysis.relationships) {
        this.#insert_relationship(edge, file_id, resolve_key);
      }
      for (const item of analysis.imports) {
        this.#insert_import(item, file_id);
      }
      for (const item of analysis.exports) {
        this.#insert_export(item, file_id, resolve_key);
      }
      for (const item of analysis.references) {
        this.#insert_reference(item, file_id, resolve_key);
      }
    });
  }

  /** Remove a file and everything derived from it. */
  delete_file(file_path: string): void {
    this.#statements.delete_file.run(file_path);
  }

  get_file(file_path: string): code_file | undefined {
    const row = this.#statements.select_file.get(file_path) as file_row | undefined;
    return row === undefined ? undefined : to_code_file(row);
  }

  /** Every indexed path mapped to its content hash. */
  list_file_hashes(): Map<string, string> {
    const rows = this.#db.prepare('SELECT file_path, content_hash FROM files').all() as Array<{
      file_path: string;
      content_hash: string;
    }>;

    return new Map(rows.map((row) => [row.file_path, row.content_hash]));
  }

  /**
   * Path to size, mtime and hash for every indexed file.
   *
   * This is the whole input to incremental change detection, fetched in one
   * query so deciding what to reindex costs a single round trip rather than one
   * per file.
   */
  list_file_stamps(): Map<string, file_stamp> {
    const rows = this.#db
      .prepare('SELECT file_path, content_hash, size, modified_time, indexed_at FROM files')
      .all() as Array<{
      file_path: string;
      content_hash: string;
      size: number;
      modified_time: number;
      indexed_at: number;
    }>;

    return new Map(
      rows.map((row) => [
        row.file_path,
        {
          content_hash: row.content_hash,
          size: row.size,
          modified_time: row.modified_time,
          indexed_at: row.indexed_at,
        },
      ]),
    );
  }

  get_symbol(id: string): code_symbol | undefined {
    const row = this.#statements.select_symbol.get(id) as symbol_row | undefined;
    return row === undefined ? undefined : to_code_symbol(row);
  }

  find_symbols_by_name(name: string, limit = 50): readonly code_symbol[] {
    const rows = this.#statements.select_symbols_by_name.all(name, limit) as symbol_row[];
    return rows.map(to_code_symbol);
  }

  get_symbols_in_file(file_path: string): readonly code_symbol[] {
    const rows = this.#statements.select_symbols_by_file.all(file_path) as symbol_row[];
    return rows.map(to_code_symbol);
  }

  get_relationships_from(from_id: string): readonly relationship[] {
    const rows = this.#statements.select_relationships_from.all(from_id) as relationship_row[];
    return rows.map(to_relationship);
  }

  get_relationships_to(to_id: string): readonly relationship[] {
    const rows = this.#statements.select_relationships_to.all(to_id) as relationship_row[];
    return rows.map(to_relationship);
  }

  /**
   * Call edges whose target is still unknown — the input to the cross-file
   * resolution pass, which follows imports to point them at real symbols.
   */
  get_unresolved_call_edges(): readonly relationship[] {
    const rows = this.#statements.select_unresolved_calls.all() as relationship_row[];
    return rows.map(to_relationship);
  }

  get_all_imports(): readonly code_import[] {
    const rows = this.#statements.select_all_imports.all() as import_row[];
    return rows.map(to_code_import);
  }

  get_all_exports(): readonly code_export[] {
    const rows = this.#statements.select_all_exports.all() as export_row[];
    return rows.map(to_code_export);
  }

  get_symbols_by_parent(parent_id: string): readonly code_symbol[] {
    const rows = this.#statements.select_symbols_by_parent.all(parent_id) as symbol_row[];
    return rows.map(to_code_symbol);
  }

  get_symbols_by_ids(ids: readonly string[]): readonly code_symbol[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.#db
      .prepare(
        `SELECT s.*, f.file_path FROM symbols s JOIN files f ON f.file_id = s.file_id
         WHERE s.id IN (${placeholders})`,
      )
      .all(...ids) as symbol_row[];
    return rows.map(to_code_symbol);
  }

  /** Every indexed path, as POSIX paths relative to the project root. */
  list_file_paths(): readonly string[] {
    const rows = this.#statements.select_file_paths.all() as Array<{ file_path: string }>;
    return rows.map((row) => row.file_path);
  }

  /** Point an unresolved edge at its resolved target, upgrading confidence. */
  set_edge_target(edge_id: string, to_id: string): void {
    this.#statements.update_edge_target.run(to_id, Number(edge_id));
  }

  /** Record where an import's specifier resolved to. */
  set_import_resolved_path(import_id: string, resolved_path: string): void {
    this.#statements.update_import_resolved_path.run(resolved_path, Number(import_id));
  }

  /** Point an unresolved reference at the symbol it turned out to name. */
  set_reference_target(reference_id: string, symbol_id: string): void {
    this.#statements.update_reference_target.run(symbol_id, Number(reference_id));
  }

  /** Every occurrence pointing at a symbol, definition first. */
  get_references_to(symbol_id: string): readonly code_reference[] {
    const rows = this.#statements.select_references_to.all(symbol_id) as reference_row[];
    return rows.map(to_code_reference);
  }

  /**
   * References that are uses (not declarations) with no resolved target — the
   * cross-file names the graph resolution pass can follow through imports.
   */
  get_unresolved_references(): readonly code_reference[] {
    const rows = this.#statements.select_unresolved_references.all() as reference_row[];
    return rows.map(to_code_reference);
  }

  get_imports_in_file(file_path: string): readonly code_import[] {
    const rows = this.#statements.select_imports_by_file.all(file_path) as import_row[];
    return rows.map(to_code_import);
  }

  /**
   * Imports whose specifier resolved to `file_path` — the reverse dependency
   * edge. Backs get_dependents: who pulls this module in.
   */
  get_imports_resolved_to(file_path: string): readonly code_import[] {
    const rows = this.#statements.select_imports_resolved_to.all(file_path) as import_row[];
    return rows.map(to_code_import);
  }

  get_exports_in_file(file_path: string): readonly code_export[] {
    const rows = this.#statements.select_exports_by_file.all(file_path) as export_row[];
    return rows.map(to_code_export);
  }

  find_references_by_name(name: string, limit = 100): readonly code_reference[] {
    const rows = this.#statements.select_references_by_name.all(name, limit) as reference_row[];
    return rows.map(to_code_reference);
  }

  /**
   * Symbols whose name matches, with filters applied in SQL.
   *
   * The three match modes are issued as separate statements by the caller
   * rather than combined into one `OR`, because `name = ?` and `name LIKE 'q%'`
   * can use the name index while `LIKE '%q%'` cannot. Running them in
   * precedence order also means exact matches are found without scanning.
   */
  query_symbols(options: symbol_query): readonly code_symbol[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];

    conditions.push(options.name_condition.sql);
    parameters.push(...options.name_condition.parameters);

    if (options.kinds !== undefined && options.kinds.length > 0) {
      conditions.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`);
      parameters.push(...options.kinds);
    }

    if (options.languages !== undefined && options.languages.length > 0) {
      conditions.push(`s.language IN (${options.languages.map(() => '?').join(', ')})`);
      parameters.push(...options.languages);
    }

    if (options.path_like !== undefined) {
      conditions.push(`f.file_path LIKE ? ESCAPE '\\'`);
      parameters.push(options.path_like);
    }

    if (options.exported_only === true) {
      conditions.push(`export_kind != 'none'`);
    }

    if (options.exclude_ambient === true) {
      conditions.push('is_ambient = 0');
    }

    parameters.push(options.limit);

    const rows = this.#db
      .prepare(
        `SELECT s.*, f.file_path FROM symbols s
         JOIN files f ON f.file_id = s.file_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY length(s.name), f.file_path, s.start_line LIMIT ?`,
      )
      .all(...parameters) as symbol_row[];

    return rows.map(to_code_symbol);
  }

  /** Indexed files, optionally narrowed by language or path. */
  list_files(options: file_query = {}): readonly code_file[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];

    if (options.languages !== undefined && options.languages.length > 0) {
      conditions.push(`language IN (${options.languages.map(() => '?').join(', ')})`);
      parameters.push(...options.languages);
    }

    if (options.path_like !== undefined) {
      conditions.push(`file_path LIKE ? ESCAPE '\\'`);
      parameters.push(options.path_like);
    }

    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const rows = this.#db
      .prepare(`SELECT * FROM files ${where} ORDER BY file_path`)
      .all(...parameters) as file_row[];

    return rows.map(to_code_file);
  }

  count(): index_counts {
    return {
      files: this.#count_rows('files'),
      symbols: this.#count_rows('symbols'),
      relationships: this.#count_rows('relationships'),
      references: this.#count_rows(REFERENCES_TABLE),
      imports: this.#count_rows('imports'),
      exports: this.#count_rows('exports'),
    };
  }

  set_metadata(key: string, value: string): void {
    this.#statements.set_metadata.run(key, value);
  }

  get_metadata(key: string): string | undefined {
    const row = this.#statements.get_metadata.get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Run `work` inside a transaction, rolling back if it throws. */
  transaction<result>(work: () => result): result {
    return this.#db.transaction(work)();
  }

  /** Reclaim space and refresh planner statistics after a large reindex. */
  optimize(): void {
    this.#db.exec('PRAGMA optimize');
  }

  close(): void {
    this.#db.close();
  }

  #count_rows(table: string): number {
    const row = this.#db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number };
    return row.total;
  }

  #insert_file(file: code_file): number {
    const row = this.#statements.insert_file.get(
      file.file_path,
      file.absolute_path,
      file.language,
      file.size,
      file.modified_time,
      file.content_hash,
      file.parse_error_count,
      to_sql_nullable(file.package_path),
      to_sql_nullable(file.package_name),
      Date.now(),
    ) as { file_id: number };
    return row.file_id;
  }

  #insert_symbol(symbol: code_symbol, file_id: number): number {
    const row = this.#statements.insert_symbol.get(
      symbol.id,
      symbol.name,
      symbol.kind,
      file_id,
      symbol.language,
      symbol.start_line,
      symbol.end_line,
      symbol.start_column,
      symbol.end_column,
      to_sql_nullable(symbol.parent_id),
      to_sql_nullable(symbol.signature),
      symbol.export_kind,
      to_sql_boolean(symbol.is_ambient),
    ) as { key: number };
    return row.key;
  }

  #insert_relationship(
    edge: relationship,
    file_id: number,
    resolve_key: (id: string | undefined) => number | null,
  ): void {
    const from_key = edge.from_id.indexOf('#') === -1 ? null : resolve_key(edge.from_id);
    this.#statements.insert_relationship.run(
      edge.kind,
      from_key,
      resolve_key(edge.to_id),
      edge.to_name,
      edge.confidence,
      file_id,
      edge.line,
    );
  }

  #insert_import(item: code_import, file_id: number): void {
    this.#statements.insert_import.run(
      file_id,
      item.kind,
      item.module_specifier,
      to_sql_nullable(item.imported_name),
      to_sql_nullable(item.local_name),
      to_sql_nullable(item.resolved_path),
      to_sql_boolean(item.is_internal),
      item.line,
    );
  }

  #insert_export(
    item: code_export,
    file_id: number,
    resolve_key: (id: string | undefined) => number | null,
  ): void {
    this.#statements.insert_export.run(
      file_id,
      item.kind,
      item.exported_name,
      to_sql_nullable(item.local_name),
      resolve_key(item.symbol_id),
      to_sql_nullable(item.module_specifier),
      item.line,
    );
  }

  #insert_reference(
    item: code_reference,
    file_id: number,
    resolve_key: (id: string | undefined) => number | null,
  ): void {
    this.#statements.insert_reference.run(
      file_id,
      item.name,
      resolve_key(item.symbol_id),
      resolve_key(item.enclosing_symbol_id),
      item.line,
      item.column,
      to_sql_boolean(item.is_definition),
    );
  }

  /** The current key for a live symbol, or null when it is not indexed. */
  #live_symbol_key(id: string): number | null {
    const row = this.#statements.select_symbol_key.get(id) as { key: number } | undefined;
    return row?.key ?? null;
  }
}

function open_database(options: open_index_store_options): database_handle {
  const database_path =
    options.in_memory === true ? ':memory:' : join(options.data_dir_path, DATABASE_FILE_NAME);

  if (options.in_memory !== true) {
    ensure_data_directory(options.data_dir_path);
  }

  let db: database_handle;
  try {
    db = new Database(database_path);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'index_unavailable',
      message: `The index database could not be opened at ${database_path}: ${describe_unknown_error(cause)}`,
      hint: 'Check that the project directory is writable, or delete .code-intelligence to start over.',
      cause,
    });
  }

  configure_pragmas(db, options.in_memory === true);
  apply_schema(db);
  return db;
}

function configure_pragmas(db: database_handle, in_memory: boolean): void {
  // Cascading deletes are the basis of per-file reindexing, and SQLite leaves
  // foreign keys off by default, so this is not optional.
  db.pragma('foreign_keys = ON');

  if (!in_memory) {
    // WAL lets a reader (an MCP query) proceed while the indexer writes.
    db.pragma('journal_mode = WAL');
    // With WAL, NORMAL is durable across process crashes; only a power loss can
    // lose the last commits, and the index is a rebuildable cache either way.
    db.pragma('synchronous = NORMAL');
  }
}

/**
 * Create the schema, rebuilding it when the stored version is out of date.
 *
 * The index is derived data. Rebuilding from source is always possible and
 * always correct, so migration code would be a liability rather than a feature.
 */
function apply_schema(db: database_handle): void {
  const stored_version = read_schema_version(db);

  if (stored_version !== undefined && stored_version !== SCHEMA_VERSION) {
    db.exec(DROP_SCHEMA_SQL);
  }

  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(
    METADATA_KEYS.schema_version,
    String(SCHEMA_VERSION),
  );
}

function read_schema_version(db: database_handle): number | undefined {
  const table_exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'")
    .get();
  if (table_exists === undefined) {
    return undefined;
  }

  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(METADATA_KEYS.schema_version) as
    { value: string } | undefined;
  if (row === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(row.value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Create the data directory, with a `.gitignore` that excludes it entirely.
 *
 * The index is a derived cache containing paths and symbol names from the
 * project; committing it would be noise at best and a leak at worst.
 */
function ensure_data_directory(data_dir_path: string): void {
  try {
    mkdirSync(data_dir_path, { recursive: true });
    writeFileSync(join(data_dir_path, '.gitignore'), '# Generated index; not source.\n*\n', 'utf8');
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'index_unavailable',
      message: `The data directory could not be created at ${data_dir_path}: ${describe_unknown_error(cause)}`,
      hint: `Check write permissions for ${dirname(data_dir_path)}.`,
      cause,
    });
  }
}

function prepare_statements(db: database_handle): prepared_statements {
  // Every row of a non-`files` table carries `file_path` only through this
  // join; the tables themselves store the integer `file_id`.
  const symbols_select = 'SELECT s.*, f.file_path FROM symbols s JOIN files f ON f.file_id = s.file_id';

  // `from_id` is the enclosing symbol's id, or the file path for file-level
  // edges; `to_id` is the target symbol's id, or NULL while unresolved.
  const relationships_select = `
    SELECT r.key, r.kind, r.to_name, r.confidence, r.line, f.file_path,
           CASE WHEN r.from_key IS NULL OR fs.id IS NULL THEN f.file_path ELSE fs.id END AS from_id,
           ts.id AS to_id
    FROM relationships r
    JOIN files f ON f.file_id = r.file_id
    LEFT JOIN symbols fs ON fs.key = r.from_key
    LEFT JOIN symbols ts ON ts.key = r.to_key`;

  const references_select = `
    SELECT r.key, r.name, r.line, r.column, r.is_definition, f.file_path,
           s.id AS symbol_id,
           es.id AS enclosing_symbol_id
    FROM ${REFERENCES_TABLE} r
    JOIN files f ON f.file_id = r.file_id
    LEFT JOIN symbols s ON s.key = r.symbol_key
    LEFT JOIN symbols es ON es.key = r.enclosing_symbol_key`;

  const imports_select = `
    SELECT i.key, i.kind, i.module_specifier, i.imported_name, i.local_name,
           i.resolved_path, i.is_internal, i.line, f.file_path
    FROM imports i
    JOIN files f ON f.file_id = i.file_id`;

  const exports_select = `
    SELECT e.key, e.kind, e.exported_name, e.local_name, e.module_specifier, e.line,
           f.file_path, s.id AS symbol_id
    FROM exports e
    JOIN files f ON f.file_id = e.file_id
    LEFT JOIN symbols s ON s.key = e.symbol_key`;

  return {
    insert_file: db.prepare(
      `INSERT INTO files (file_path, absolute_path, language, size, modified_time, content_hash,
                          parse_error_count, package_path, package_name, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING file_id`,
    ),
    insert_symbol: db.prepare(
      `INSERT INTO symbols (id, name, kind, file_id, language, start_line, end_line,
                            start_column, end_column, parent_id, signature, export_kind, is_ambient)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING key`,
    ),
    insert_relationship: db.prepare(
      `INSERT INTO relationships (kind, from_key, to_key, to_name, confidence, file_id, line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insert_reference: db.prepare(
      `INSERT INTO ${REFERENCES_TABLE} (file_id, name, symbol_key, enclosing_symbol_key,
                                        line, column, is_definition)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insert_import: db.prepare(
      `INSERT INTO imports (file_id, kind, module_specifier, imported_name, local_name,
                            resolved_path, is_internal, line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insert_export: db.prepare(
      `INSERT INTO exports (file_id, kind, exported_name, local_name, symbol_key,
                            module_specifier, line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    delete_file: db.prepare('DELETE FROM files WHERE file_path = ?'),
    select_file: db.prepare('SELECT * FROM files WHERE file_path = ?'),
    select_symbol: db.prepare(`${symbols_select} WHERE s.id = ?`),
    select_symbols_by_name: db.prepare(
      `${symbols_select} WHERE s.name = ? ORDER BY f.file_path, s.start_line LIMIT ?`,
    ),
    select_symbols_by_file: db.prepare(`${symbols_select} WHERE f.file_path = ? ORDER BY s.start_line`),
    select_relationships_from: db.prepare(
      `${relationships_select} WHERE r.from_key = (SELECT key FROM symbols WHERE id = ?)`,
    ),
    select_relationships_to: db.prepare(
      `${relationships_select} WHERE r.to_key = (SELECT key FROM symbols WHERE id = ?)`,
    ),
    select_unresolved_calls: db.prepare(
      `${relationships_select} WHERE r.kind = 'calls' AND r.to_key IS NULL`,
    ),
    select_all_imports: db.prepare(`${imports_select}`),
    select_all_exports: db.prepare(`${exports_select}`),
    select_symbols_by_parent: db.prepare(`${symbols_select} WHERE s.parent_id = ? ORDER BY s.start_line`),
    select_file_paths: db.prepare('SELECT file_path FROM files ORDER BY file_path'),
    select_imports_by_file: db.prepare(`${imports_select} WHERE f.file_path = ? ORDER BY i.line`),
    select_imports_resolved_to: db.prepare(
      `${imports_select} WHERE i.resolved_path = ? ORDER BY f.file_path, i.line`,
    ),
    select_exports_by_file: db.prepare(`${exports_select} WHERE f.file_path = ? ORDER BY e.line`),
    select_references_by_name: db.prepare(
      `${references_select} WHERE r.name = ? ORDER BY f.file_path, r.line LIMIT ?`,
    ),
    select_references_to: db.prepare(
      `${references_select} WHERE r.symbol_key = (SELECT key FROM symbols WHERE id = ?)
       ORDER BY r.is_definition DESC, f.file_path, r.line, r.column`,
    ),
    select_unresolved_references: db.prepare(
      `${references_select} WHERE r.symbol_key IS NULL AND r.is_definition = 0`,
    ),
    select_symbol_key: db.prepare('SELECT key FROM symbols WHERE id = ?'),
    update_edge_target: db.prepare(
      `UPDATE relationships SET to_key = (SELECT key FROM symbols WHERE id = ?),
                                confidence = 'resolved'
       WHERE key = ?`,
    ),
    update_import_resolved_path: db.prepare('UPDATE imports SET resolved_path = ? WHERE key = ?'),
    update_reference_target: db.prepare(
      `UPDATE ${REFERENCES_TABLE} SET symbol_key = (SELECT key FROM symbols WHERE id = ?) WHERE key = ?`,
    ),
    set_metadata: db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'),
    get_metadata: db.prepare('SELECT value FROM metadata WHERE key = ?'),
  };
}
