/**
 * Parsing and extraction of a single file into the shape the store writes.
 *
 * Kept separate from `index_project` so the analysis worker can load it
 * without pulling in the store, the scanner or the pool that spawns it.
 */

import { extract_file } from '../extract/extract_file.js';
import type { file_index } from '../extract/module_resolution.js';
import { hash_content } from '../core/hash.js';
import type { code_file, file_analysis } from '../model/file.js';
import { parse_file } from '../parser/parse_file.js';
import type { scanned_file } from '../scanner/types.js';
import { normalize_modified_time } from './change_detection.js';

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
