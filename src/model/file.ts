/**
 * The file record, and the per-file bundle everything downstream consumes.
 */

import type { language_id } from '../scanner/language.js';
import type { code_symbol } from './symbol.js';
import type { relationship } from './relationship.js';
import type { code_export, code_import, code_reference } from './module_graph.js';

export interface code_file {
  /** POSIX path relative to the project root. Also the primary key. */
  readonly file_path: string;
  /** Absolute native path, for filesystem access. */
  readonly absolute_path: string;
  readonly language: language_id;
  readonly size: number;
  readonly modified_time: number;
  /**
   * Content hash. Phase 7 compares this to decide whether a file needs
   * reparsing, so it must cover content only — not mtime, which changes on a
   * checkout that did not alter the file.
   */
  readonly content_hash: string;
  /** Number of syntax errors found while parsing. Zero means a clean parse. */
  readonly parse_error_count: number;
  /**
   * Owning package for monorepos: the directory of the nearest package.json,
   * as a POSIX path relative to the root. Absent when there is none above it.
   */
  readonly package_path?: string | undefined;
  readonly package_name?: string | undefined;
}

/**
 * Everything extracted from one file.
 *
 * Produced per file and written to the index per file, so a changed file can be
 * replaced atomically without touching its neighbours (Phase 7).
 */
export interface file_analysis {
  readonly file: code_file;
  readonly symbols: readonly code_symbol[];
  readonly relationships: readonly relationship[];
  readonly imports: readonly code_import[];
  readonly exports: readonly code_export[];
  readonly references: readonly code_reference[];
}

export function create_empty_analysis(file: code_file): file_analysis {
  return {
    file,
    symbols: [],
    relationships: [],
    imports: [],
    exports: [],
    references: [],
  };
}
