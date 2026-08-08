/**
 * Deciding which files need reindexing.
 *
 * Two stages, because the cheap signal and the trustworthy signal are different
 * things:
 *
 * 1. **Here (no I/O).** Compare size and mtime against what the index recorded.
 *    A file matching both is skipped outright — no read, no parse. This is what
 *    makes a re-run on an unchanged repository nearly free.
 *
 * 2. **In the indexer.** Files that failed the cheap check are parsed anyway,
 *    and the hash of the parsed source is compared to the stored hash. If they
 *    match, the file was touched but not edited and the database is left alone.
 *
 * The split matters because mtime is a poor proxy for content. `git checkout`,
 * `git stash`, a fresh clone and many editors rewrite mtimes on files whose
 * bytes never changed. Trusting mtime alone would reindex the world after every
 * branch switch; trusting hashes alone would mean reading every file every time.
 * Doing both, in this order, avoids each failure.
 */

import type { file_stamp } from '../store/index_store.js';
import type { scanned_file } from '../scanner/types.js';

export interface change_set {
  /** Not present in the index at all. */
  readonly added: readonly scanned_file[];
  /**
   * Size or mtime differs, so the content *may* have changed. Confirmed by
   * hash after parsing — these are candidates, not confirmed edits.
   */
  readonly candidates: readonly scanned_file[];
  /** Size and mtime both match; skipped without being read. */
  readonly unchanged: readonly scanned_file[];
  /** Indexed previously, no longer on disk (or no longer scannable). */
  readonly deleted: readonly string[];
}

export interface detect_changes_options {
  /** Current index contents, from `index_store.list_file_stamps()`. */
  readonly stored: ReadonlyMap<string, file_stamp>;
  /** What the scanner just found. */
  readonly scanned: readonly scanned_file[];
}

/**
 * Classify scanned files against the index. Performs no I/O.
 *
 * On an empty index every file lands in `added`, so a first run and an
 * incremental run are the same code path.
 */
export function detect_changes(options: detect_changes_options): change_set {
  const added: scanned_file[] = [];
  const candidates: scanned_file[] = [];
  const unchanged: scanned_file[] = [];

  // Starts as every indexed path; each path still on disk is removed, so what
  // remains is exactly the set that disappeared.
  const missing = new Set(options.stored.keys());

  for (const file of options.scanned) {
    const stamp = options.stored.get(file.relative_path);

    if (stamp === undefined) {
      added.push(file);
      continue;
    }

    missing.delete(file.relative_path);

    if (is_same_stamp(stamp, file)) {
      unchanged.push(file);
    } else {
      candidates.push(file);
    }
  }

  return { added, candidates, unchanged, deleted: [...missing] };
}

/**
 * How close a file's mtime may be to the moment it was indexed before its
 * fingerprint stops being trustworthy.
 *
 * Filesystem timestamps are coarse — commonly 1s, and 2s on FAT — and `stat`
 * exposes them in milliseconds, so a file edited very shortly after being
 * indexed can carry the exact same mtime it had when it was read. Two seconds
 * covers the worst granularity in normal use.
 */
export const RACY_WINDOW_MS = 2_000;

/**
 * Compare the cheap fingerprint.
 *
 * Two subtleties, both of which cause silent staleness when missed:
 *
 * 1. mtime is normalized the same way it is stored, so a float from `stat` and
 *    an integer from SQLite compare equal. Without it every file would look
 *    modified on every run, quietly turning incremental indexing into a full
 *    reindex.
 *
 * 2. A file whose mtime sits within `RACY_WINDOW_MS` of when it was indexed is
 *    never trusted, even when size and mtime both match. It may have been
 *    edited in the same timestamp tick in which it was read, and if the edit
 *    also left the size unchanged, nothing in the fingerprint would show it.
 *    Git calls these entries racily clean and handles them the same way. The
 *    cost is re-hashing a handful of just-touched files; the alternative is an
 *    index that is silently wrong.
 */
function is_same_stamp(stamp: file_stamp, file: scanned_file): boolean {
  if (stamp.size !== file.size) {
    return false;
  }

  const modified_time = normalize_modified_time(file.modified_time);
  if (stamp.modified_time !== modified_time) {
    return false;
  }

  return modified_time < stamp.indexed_at - RACY_WINDOW_MS;
}

/** `stat` reports fractional milliseconds; the index stores whole ones. */
export function normalize_modified_time(modified_time: number): number {
  return Math.round(modified_time);
}
