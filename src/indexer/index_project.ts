/**
 * Indexing: scan, decide what actually changed, parse only that, store it.
 *
 * There is deliberately no separate "full index" and "incremental index" code
 * path. On an empty index every file is new, so the first run and the thousandth
 * run execute the same logic. Two code paths would mean two sets of bugs, and
 * the rarely-taken one would be the broken one.
 *
 * Files are processed a batch at a time and each result is discarded as soon as
 * it is written, so memory stays flat regardless of repository size. Writes are
 * grouped into batched transactions because SQLite fsyncs on every commit.
 * Within a batch, files are analysed in parallel on a worker pool when one is
 * available (see `analyze_pool.ts`); results are still written in scan order.
 *
 * A file that fails to parse is recorded and skipped, never fatal. One
 * unreadable file in a 10,000 file repository must not cost the other 9,999.
 */

import { build_file_index } from '../extract/module_resolution.js';
import { describe_unknown_error } from '../core/errors.js';
import type { logger } from '../core/logger.js';
import type { file_analysis } from '../model/file.js';
import { scan_project } from '../scanner/file_scanner.js';
import type { scan_options, scanned_file } from '../scanner/types.js';
import { METADATA_KEYS } from '../store/schema.js';
import type { index_store } from '../store/index_store.js';
import { analyze_file } from './analyze_file.js';
import { create_analyze_pool, default_pool_size, MIN_FILES_FOR_POOL } from './analyze_pool.js';
import { detect_changes } from './change_detection.js';
import { resolve_project_graph } from './resolve_project_graph.js';

export { analyze_file } from './analyze_file.js';

/**
 * Files written per transaction. Large enough to amortize commits, small enough
 * that a crash loses little and memory stays bounded.
 */
export const DEFAULT_WRITE_BATCH_SIZE = 200;

/** Below this many files a first index keeps its indexes; rebuilding them would cost more. */
const BULK_LOAD_MIN_FILES = 500;

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
  /**
   * Worker threads for parsing. Defaults to one fewer than the CPU count
   * (at most 4); 0 or 1 analyses in-process. Small runs never start a pool.
   */
  readonly workers?: number;
}

export interface index_failure {
  readonly relative_path: string;
  readonly reason: string;
}

/** Where an indexing run's wall-clock time went, so slow runs can be diagnosed. */
export interface index_timings {
  /** Directory walk, language detection and ignore-rule resolution. */
  readonly scan_ms: number;
  /** Parsing and extraction of the files that needed work. */
  readonly analyze_ms: number;
  /** Committing analyses to the database. */
  readonly write_ms: number;
  /** The cross-file graph resolution pass. */
  readonly graph_ms: number;
  readonly total_ms: number;
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
  readonly timings: index_timings;
}

export async function index_project(options: index_project_options): Promise<index_project_result> {
  const started_at = Date.now();
  const { store, root_path } = options;
  const batch_size = options.batch_size ?? DEFAULT_WRITE_BATCH_SIZE;
  const log = options.logger;

  const timings = {
    scan_ms: 0,
    analyze_ms: 0,
    write_ms: 0,
    graph_ms: 0,
  };

  const scan_started_at = Date.now();
  const scan = await scan_project({ root_path, ...options.scan });
  timings.scan_ms = Date.now() - scan_started_at;
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

  const pool =
    work.length >= MIN_FILES_FOR_POOL
      ? create_analyze_pool({ files, size: options.workers ?? default_pool_size() })
      : undefined;

  // A first index into an empty database loads every row at once, so the
  // secondary indexes are built once at the end instead of updated per row.
  // Not under `force`: there the old rows are still present, and each file's
  // cascade delete needs the indexes.
  const bulk_load = options.force !== true && stored.size === 0 && work.length >= BULK_LOAD_MIN_FILES;
  if (bulk_load) {
    store.drop_secondary_indexes();
  }
  const start_batch = (offset: number): started_batch => {
    const batch = work.slice(offset, offset + batch_size);
    return {
      batch,
      // Without a pool, one file at a time: starting them all would only hold
      // every source in memory at once, with no parallelism to show for it.
      results:
        pool === undefined
          ? settle_in_sequence(batch, (item) => analyze_file(item.file, files))
          : Promise.allSettled(batch.map((item) => pool.analyze(item.file))),
    };
  };

  try {
    let next: started_batch | undefined = work.length > 0 ? start_batch(0) : undefined;
    for (let offset = 0; next !== undefined; offset += batch_size) {
      const analyze_started_at = Date.now();
      const { batch, results } = next;
      const settled = await results;
      timings.analyze_ms += Date.now() - analyze_started_at;

      // Started before this batch is written, so the pool keeps parsing while
      // the main thread is busy in the write transaction.
      next = offset + batch_size < work.length ? start_batch(offset + batch_size) : undefined;

      const writes = collect_batch(batch, settled, stored, stats, failures, log);
      const write_started_at = Date.now();
      store.transaction(() => {
        for (const analysis of writes) {
          store.write_file_analysis(analysis);
        }
      });
      timings.write_ms += Date.now() - write_started_at;
    }
  } finally {
    await pool?.close();
    if (bulk_load) {
      const index_started_at = Date.now();
      store.restore_secondary_indexes();
      timings.write_ms += Date.now() - index_started_at;
    }
  }

  store.set_metadata(METADATA_KEYS.indexed_at, String(Date.now()));

  // Only worth the cost when something actually moved.
  if (stats.files_added + stats.files_updated + changes.deleted.length > 0) {
    // With the per-file graph stored, follow imports across files and point
    // every unresolved call edge at the symbol it actually calls.
    const graph_started_at = Date.now();
    resolve_project_graph({
      store,
      root_path,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    store.optimize();
    timings.graph_ms = Date.now() - graph_started_at;
  }

  return {
    ...stats,
    files_removed: changes.deleted.length,
    duration_ms: Date.now() - started_at,
    failures,
    timings: {
      ...timings,
      total_ms: Date.now() - started_at,
    },
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

interface started_batch {
  readonly batch: readonly work_item[];
  readonly results: Promise<PromiseSettledResult<file_analysis>[]>;
}

/** `Promise.allSettled`, but starting each call only after the previous one settles. */
async function settle_in_sequence<item_type, value_type>(
  items: readonly item_type[],
  run: (item: item_type) => Promise<value_type>,
): Promise<PromiseSettledResult<value_type>[]> {
  const settled: PromiseSettledResult<value_type>[] = [];
  for (const item of items) {
    try {
      settled.push({ status: 'fulfilled', value: await run(item) });
    } catch (reason: unknown) {
      settled.push({ status: 'rejected', reason });
    }
  }
  return settled;
}

/** Tally one batch's analyses and pick out the ones that need writing. */
function collect_batch(
  batch: readonly work_item[],
  settled: readonly PromiseSettledResult<file_analysis>[],
  stored: ReadonlyMap<string, { content_hash: string }>,
  stats: mutable_stats,
  failures: index_failure[],
  log: logger | undefined,
): file_analysis[] {
  const writes: file_analysis[] = [];

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    try {
      const result = settled[index]!;
      if (result.status === 'rejected') {
        throw result.reason;
      }
      const analysis = result.value;
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
