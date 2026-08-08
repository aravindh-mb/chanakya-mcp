/**
 * Conversion between database rows and model objects.
 *
 * SQLite has no boolean type and uses `null` where the model uses `undefined`,
 * so the translation is kept in one place rather than smeared across queries.
 */

import type { language_id } from '../scanner/language.js';
import type { code_file } from '../model/file.js';
import type { code_symbol, export_kind, symbol_kind } from '../model/symbol.js';
import type { relationship, relationship_confidence, relationship_kind } from '../model/relationship.js';
import type {
  code_export,
  code_import,
  code_reference,
  export_kind_detail,
  import_kind,
} from '../model/module_graph.js';

export interface file_row {
  file_path: string;
  absolute_path: string;
  language: string;
  size: number;
  modified_time: number;
  content_hash: string;
  parse_error_count: number;
  package_path: string | null;
  package_name: string | null;
  indexed_at: number;
}

export interface symbol_row {
  /** Internal rowid. Not part of the public model. */
  key: number;
  id: string;
  name: string;
  kind: string;
  /** Joined from `files`. */
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  parent_id: string | null;
  signature: string | null;
  export_kind: string;
  is_ambient: number;
}

export interface relationship_row {
  /** Internal rowid. Surfaced as the opaque `id`. */
  key: number;
  kind: string;
  /** Joined from `symbols`/`files`; a file path for file-level edges. */
  from_id: string;
  /** Joined from `symbols`. */
  to_id: string | null;
  to_name: string;
  confidence: string;
  /** Joined from `files`. */
  file_path: string;
  line: number;
}

export interface import_row {
  /** Internal rowid. Surfaced as the opaque `id`. */
  key: number;
  /** Joined from `files`. */
  file_path: string;
  kind: string;
  module_specifier: string;
  imported_name: string | null;
  local_name: string | null;
  resolved_path: string | null;
  is_internal: number;
  line: number;
}

export interface export_row {
  /** Internal rowid. Surfaced as the opaque `id`. */
  key: number;
  /** Joined from `files`. */
  file_path: string;
  kind: string;
  exported_name: string;
  local_name: string | null;
  /** Joined from `symbols`. */
  symbol_id: string | null;
  module_specifier: string | null;
  line: number;
}

export interface reference_row {
  /** Internal rowid. Surfaced as the opaque `id`. */
  key: number;
  /** Joined from `files`. */
  file_path: string;
  name: string;
  /** Joined from `symbols`. */
  symbol_id: string | null;
  /** Joined from `symbols`. */
  enclosing_symbol_id: string | null;
  line: number;
  column: number;
  is_definition: number;
}

/** SQLite stores booleans as 0/1. */
export function to_sql_boolean(value: boolean): number {
  return value ? 1 : 0;
}

export function from_sql_boolean(value: number): boolean {
  return value !== 0;
}

/** SQLite uses NULL where the model uses `undefined`. */
export function to_sql_nullable(value: string | undefined): string | null {
  return value ?? null;
}

export function from_sql_nullable(value: string | null): string | undefined {
  return value ?? undefined;
}

export function to_code_file(row: file_row): code_file {
  return {
    file_path: row.file_path,
    absolute_path: row.absolute_path,
    language: row.language as language_id,
    size: row.size,
    modified_time: row.modified_time,
    content_hash: row.content_hash,
    parse_error_count: row.parse_error_count,
    package_path: from_sql_nullable(row.package_path),
    package_name: from_sql_nullable(row.package_name),
  };
}

export function to_code_symbol(row: symbol_row): code_symbol {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as symbol_kind,
    file_path: row.file_path,
    language: row.language as language_id,
    start_line: row.start_line,
    end_line: row.end_line,
    start_column: row.start_column,
    end_column: row.end_column,
    parent_id: from_sql_nullable(row.parent_id),
    signature: from_sql_nullable(row.signature),
    export_kind: row.export_kind as export_kind,
    is_ambient: from_sql_boolean(row.is_ambient),
  };
}

export function to_relationship(row: relationship_row): relationship {
  return {
    id: String(row.key),
    kind: row.kind as relationship_kind,
    from_id: row.from_id,
    to_id: from_sql_nullable(row.to_id),
    to_name: row.to_name,
    confidence: row.confidence as relationship_confidence,
    file_path: row.file_path,
    line: row.line,
  };
}

export function to_code_import(row: import_row): code_import {
  return {
    id: String(row.key),
    file_path: row.file_path,
    kind: row.kind as import_kind,
    module_specifier: row.module_specifier,
    imported_name: from_sql_nullable(row.imported_name),
    local_name: from_sql_nullable(row.local_name),
    resolved_path: from_sql_nullable(row.resolved_path),
    is_internal: from_sql_boolean(row.is_internal),
    line: row.line,
  };
}

export function to_code_export(row: export_row): code_export {
  return {
    id: String(row.key),
    file_path: row.file_path,
    kind: row.kind as export_kind_detail,
    exported_name: row.exported_name,
    local_name: from_sql_nullable(row.local_name),
    symbol_id: from_sql_nullable(row.symbol_id),
    module_specifier: from_sql_nullable(row.module_specifier),
    line: row.line,
  };
}

export function to_code_reference(row: reference_row): code_reference {
  return {
    id: String(row.key),
    file_path: row.file_path,
    name: row.name,
    symbol_id: from_sql_nullable(row.symbol_id),
    enclosing_symbol_id: from_sql_nullable(row.enclosing_symbol_id),
    line: row.line,
    column: row.column,
    is_definition: from_sql_boolean(row.is_definition),
  };
}
