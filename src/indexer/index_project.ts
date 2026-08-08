/**
 * The first full indexing pass: scan, parse, extract, store.
 *
 * Files are processed one at a time and each result is discarded as soon as it
 * is written, so memory stays flat regardless of repository size. Writes are
 * grouped into batched transactions because committing per file dominates the
 * runtime on a large repository — SQLite fsyncs on each commit.
 *
 * A file that fails to parse is recorded and skipped, never fatal. One
 * unreadable file in a 10,000 file repository must not cost the other 9,999.
 */

import { extract_symbols } from '../extract/symbol_extractor.js';
import { describe_unknown_error } from '../core/errors.js';
import { hash_content } from '../core/hash.js';
import type { logger } from '../core/logger.js';
import type { code_file, file_analysis } from '../model/file.js';
import { parse_file } from '../parser/parse_file.js';
import { scan_project } from '../scanner/file_scanner.js';
import type { scan_options, scanned_file } from '../scanner/types.js';
import { METADATA_KEYS } from '../store/schema.js';
import type { index_store } from '../store/index_store.js';

/** Files written per transaction. Large enough to amortize commits, small
 *  enough that a crash loses little and memory stays bounded. */
export const DEFAULT_WRITE_BATCH_SIZE = 200;

export interface index_project_options {
  readonly store: index_store;
  readonly root_path: string;
  readonly logger?: logger;
  readonly batch_size?: number;
  /** Passed through to the scanner. */
  readonly scan?: Omit<scan_options, 'root_path'>;
}

export interface index_failure {
  readonly relative_path: string;
  readonly reason: string;
}

export interface index_project_result {
  readonly files_indexed: number;
  readonly files_failed: number;
  readonly files_with_syntax_errors: number;
  readonly symbols: number;
  readonly relationships: number;
  readonly duration_ms: number;
  readonly failures: readonly index_failure[];
}

export async function index_project(options: index_project_options): Promise<index_project_result> {
  const started_at = Date.now();
  const { store, root_path } = options;
  const batch_size = options.batch_size ?? DEFAULT_WRITE_BATCH_SIZE;

  const scan = await scan_project({ root_path, ...options.scan });
  options.logger?.debug(`indexing ${scan.files.length} files from ${root_path}`);

  let files_indexed = 0;
  let files_failed = 0;
  let files_with_syntax_errors = 0;
  let symbols = 0;
  let relationships = 0;
  const failures: index_failure[] = [];

  for (let offset = 0; offset < scan.files.length; offset += batch_size) {
    const batch = scan.files.slice(offset, offset + batch_size);
    const analyses = await analyze_batch(batch, failures, options.logger);

    store.transaction(() => {
      for (const analysis of analyses) {
        store.write_file_analysis(analysis);
      }
    });

    for (const analysis of analyses) {
      files_indexed += 1;
      symbols += analysis.symbols.length;
      relationships += analysis.relationships.length;
      if (analysis.file.parse_error_count > 0) {
        files_with_syntax_errors += 1;
      }
    }
  }

  files_failed = failures.length;

  store.set_metadata(METADATA_KEYS.indexed_at, String(Date.now()));
  store.optimize();

  return {
    files_indexed,
    files_failed,
    files_with_syntax_errors,
    symbols,
    relationships,
    duration_ms: Date.now() - started_at,
    failures,
  };
}

async function analyze_batch(
  batch: readonly scanned_file[],
  failures: index_failure[],
  log: logger | undefined,
): Promise<file_analysis[]> {
  const analyses: file_analysis[] = [];

  for (const file of batch) {
    try {
      analyses.push(await analyze_file(file));
    } catch (error: unknown) {
      // A file that cannot be parsed is recorded and skipped. One bad file in a
      // large repository must not cost all the others.
      const reason = describe_unknown_error(error);
      failures.push({ relative_path: file.relative_path, reason });
      log?.warn(`skipping ${file.relative_path}: ${reason}`);
    }
  }

  return analyses;
}

/** Parse and extract one file into the shape the store writes. */
export async function analyze_file(file: scanned_file): Promise<file_analysis> {
  const parsed = await parse_file({ file_path: file.file_path });
  const extracted = extract_symbols({ parsed, relative_path: file.relative_path });

  const record: code_file = {
    file_path: file.relative_path,
    absolute_path: file.file_path,
    language: file.language,
    size: file.size,
    modified_time: file.modified_time,
    // Hashed from the source that was actually parsed, so the stored hash
    // always corresponds to the stored symbols.
    content_hash: hash_content(parsed.source),
    parse_error_count: parsed.parse_errors.length,
  };

  return {
    file: record,
    symbols: extracted.symbols,
    relationships: extracted.relationships,
    // Populated once import, export and reference extraction lands.
    imports: [],
    exports: [],
    references: [],
  };
}
