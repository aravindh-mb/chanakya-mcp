/**
 * Indexing: scan, decide what actually changed, parse only that, store it.
 *
 * There is deliberately no separate "full index" and "incremental index" code
 * path. On an empty index every file is new, so the first run and the thousandth
 * run execute the same logic. Two code paths would mean two sets of bugs, and
 * the rarely-taken one would be the broken one.
 *
 * Files are processed one at a time and each result is discarded as soon as it
 * is written, so memory stays flat regardless of repository size. Writes are
 * grouped into batched transactions because SQLite fsyncs on every commit.
 *
 * A file that fails to parse is recorded and skipped, never fatal. One
 * unreadable file in a 10,000 file repository must not cost the other 9,999.
 */

import { extract_file } from '../extract/extract_file.js';
import { build_file_index, type file_index } from '../extract/module_resolution.js';
import { describe_unknown_error } from '../core/errors.js';
import { hash_content } from '../core/hash.js';
import type { logger } from '../core/logger.js';
import type { code_file, file_analysis } from '../model/file.js';
import { parse_file } from '../parser/parse_file.js';
import { scan_project } from '../scanner/file_scanner.js';
import type { scan_options, scanned_file } from '../scanner/types.js';
import { METADATA_KEYS } from '../store/schema.js';
import type { index_store } from '../store/index_store.js';
import { detect_changes, normalize_modified_time } from './change_detection.js';
import { resolve_project_graph } from './resolve_project_graph.js';

/**
 * Files written per transaction. Large enough to amortize commits, small enough
 * that a crash loses little and memory stays bounded.
 */
export const DEFAULT_WRITE_BATCH_SIZE = 200;

export interface index_project_options {
  readonly store: index_store;
  readonly root_path: string;
  readonly logger?: logger;
  readonly batch_size?: number;
  /**
   * Reindex every file even if its fingerprint matches. For recovering from a
   * suspected-bad index without deleting it.
   */
  readonly force?: boolean;
  /** Passed through to the scanner. */
  readonly scan?: Omit<scan_options, 'root_path'>;
}

export interface index_failure {
  readonly relative_path: string;
  readonly reason: string;
}

export interface index_project_result {
  /** New files written. */
  readonly files_added: number;
  /** Existing files whose content genuinely changed. */
  readonly files_updated: number;
  /** Files removed from the index because they are gone from disk. */
  readonly files_removed: number;
  /**
   * Files left alone. Includes both files skipped on size/mtime and files that
   * were parsed but turned out to hash identically — a touched-but-unedited
   * file, which is what a branch switch produces.
   */
  readonly files_unchanged: number;
  readonly files_failed: number;
  readonly files_with_syntax_errors: number;
  /** Files actually parsed this run. The cost that incremental indexing avoids. */
  readonly files_parsed: number;
  readonly duration_ms: number;
  readonly failures: readonly index_failure[];
}

export async function index_project(options: index_project_options): Promise<index_project_result> {
  const started_at = Date.now();
  const { store, root_path } = options;
  const batch_size = options.batch_size ?? DEFAULT_WRITE_BATCH_SIZE;
  const log = options.logger;

  const scan = await scan_project({ root_path, ...options.scan });
  const stored = options.force === true ? new Map() : store.list_file_stamps();
  const changes = detect_changes({ stored, scanned: scan.files });
  const files = build_file_index(scan.files);

  log?.debug(
    `scan found ${scan.files.length} files: ${changes.added.length} new, ` +
      `${changes.candidates.length} possibly changed, ${changes.unchanged.length} unchanged, ` +
      `${changes.deleted.length} deleted`,
  );

  // Deletions first, in one transaction: cascade removes every symbol, edge,
  // import, export and reference derived from the file.
  if (changes.deleted.length > 0) {
    store.transaction(() => {
      for (const relative_path of changes.deleted) {
        store.delete_file(relative_path);
      }
    });
  }

  const stats: mutable_stats = {
    files_added: 0,
    files_updated: 0,
    files_unchanged: changes.unchanged.length,
    files_failed: 0,
    files_with_syntax_errors: 0,
    files_parsed: 0,
  };
  const failures: index_failure[] = [];

  const work: work_item[] = [
    ...changes.added.map((file) => ({ file, is_new: true })),
    ...changes.candidates.map((file) => ({ file, is_new: false })),
  ];

  for (let offset = 0; offset < work.length; offset += batch_size) {
    const batch = work.slice(offset, offset + batch_size);
    const writes = await analyze_batch(batch, stored, stats, failures, log, files);

    store.transaction(() => {
      for (const analysis of writes) {
        store.write_file_analysis(analysis);
      }
    });
  }

  store.set_metadata(METADATA_KEYS.indexed_at, String(Date.now()));

  // Only worth the cost when something actually moved.
  if (stats.files_added + stats.files_updated + changes.deleted.length > 0) {
    // With the per-file graph stored, follow imports across files and point
    // every unresolved call edge at the symbol it actually calls.
    resolve_project_graph(
      options.logger === undefined ? { store } : { store, logger: options.logger },
    );
    store.optimize();
  }

  return {
    ...stats,
    files_removed: changes.deleted.length,
    duration_ms: Date.now() - started_at,
    failures,
  };
}

interface work_item {
  readonly file: scanned_file;
  readonly is_new: boolean;
}

interface mutable_stats {
  files_added: number;
  files_updated: number;
  files_unchanged: number;
  files_failed: number;
  files_with_syntax_errors: number;
  files_parsed: number;
}

async function analyze_batch(
  batch: readonly work_item[],
  stored: ReadonlyMap<string, { content_hash: string }>,
  stats: mutable_stats,
  failures: index_failure[],
  log: logger | undefined,
  files: file_index,
): Promise<file_analysis[]> {
  const writes: file_analysis[] = [];

  for (const item of batch) {
    try {
      const analysis = await analyze_file(item.file, files);
      stats.files_parsed += 1;

      // Second-stage check: the fingerprint said "maybe", the hash decides. A
      // file touched by a checkout hashes the same and is left untouched, which
      // keeps a branch switch from rewriting the whole index.
      if (!item.is_new && stored.get(item.file.relative_path)?.content_hash === analysis.file.content_hash) {
        stats.files_unchanged += 1;
        continue;
      }

      if (analysis.file.parse_error_count > 0) {
        stats.files_with_syntax_errors += 1;
      }
      if (item.is_new) {
        stats.files_added += 1;
      } else {
        stats.files_updated += 1;
      }

      writes.push(analysis);
    } catch (error: unknown) {
      const reason = describe_unknown_error(error);
      stats.files_failed += 1;
      failures.push({ relative_path: item.file.relative_path, reason });
      log?.warn(`skipping ${item.file.relative_path}: ${reason}`);
    }
  }

  return writes;
}

/**
 * Parse and extract one file into the shape the store writes.
 *
 * `files` is the set of indexable files the scan found; it lets the import
 * extractor resolve relative specifiers immediately. The graph resolution pass
 * later catches anything it could not.
 */
export async function analyze_file(file: scanned_file, files?: file_index): Promise<file_analysis> {
  const parsed = await parse_file({ file_path: file.file_path });
  const extracted =
    files === undefined
      ? extract_file({ parsed, relative_path: file.relative_path })
      : extract_file({ parsed, relative_path: file.relative_path, files });

  const record: code_file = {
    file_path: file.relative_path,
    absolute_path: file.file_path,
    language: file.language,
    size: file.size,
    // Stored as a whole number so it compares equal to the value read back out.
    modified_time: normalize_modified_time(file.modified_time),
    // Hashed from the source that was actually parsed, so the stored hash
    // always corresponds to the stored symbols.
    content_hash: hash_content(parsed.source),
    parse_error_count: parsed.parse_errors.length,
  };

  return {
    file: record,
    symbols: extracted.symbols,
    relationships: extracted.relationships,
    imports: extracted.imports,
    exports: extracted.exports,
    references: extracted.references,
  };
}
