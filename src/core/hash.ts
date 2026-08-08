/**
 * Content hashing for change detection.
 *
 * Phase 7 compares hashes to decide whether a file needs reparsing. It hashes
 * *content only*, never mtime: a `git checkout` or a fresh clone rewrites mtimes
 * for files whose content never changed, and reindexing those would make
 * incremental indexing pointless on exactly the workflow it exists to serve.
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 of the source text, hex encoded.
 *
 * The full digest is kept rather than a truncated prefix. Truncation trades a
 * real (if small) collision risk for a few bytes per file, and a hash collision
 * here means silently serving a stale index for a file that did change.
 */
export function hash_content(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
