/**
 * Reading and writing project files for edit operations, plus the checks that
 * make an edit "safe".
 *
 * Two rules hold. First, the path must stay inside the project: a relative
 * POSIX path is resolved against the root and verified with the containment
 * check, so a crafted `..` cannot smuggle a write out of the tree. Second, the
 * file's content on disk must still match what the index recorded — an edit
 * based on stale locations would silently clobber changes made after the last
 * index, so we refuse instead. The index refreshes on every edit (via the
 * `reindex` step), which is what keeps a second edit safe.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { hash_content } from '../core/hash.js';
import { is_path_inside } from '../core/paths.js';
import { tool_error } from '../mcp/errors.js';
import type { index_store } from '../store/index_store.js';

/**
 * Resolve a project-relative POSIX path to an absolute native path, refusing
 * anything that escapes the project root.
 */
export function resolve_project_path(root_path: string, file_path: string): string {
  if (isAbsolute(file_path) || file_path.split('/').includes('..')) {
    throw new tool_error(`'${file_path}' is not a project-relative path`);
  }
  const absolute_path = resolve(root_path, file_path);
  if (!is_path_inside(root_path, absolute_path)) {
    throw new tool_error(`'${file_path}' resolves outside the project`);
  }
  return absolute_path;
}

/**
 * Read a project file, requiring that the index is still current for it.
 * Returns the file content.
 */
export function read_current_file(store: index_store, root_path: string, file_path: string): string {
  const absolute_path = resolve_project_path(root_path, file_path);

  let content: string;
  try {
    content = readFileSync(absolute_path, 'utf8');
  } catch {
    throw new tool_error(`cannot read '${file_path}': it is missing or unreadable`);
  }

  const indexed = store.get_file(file_path);
  if (indexed === undefined) {
    throw new tool_error(`'${file_path}' is not in the index; run an index before editing`);
  }
  if (indexed.content_hash !== hash_content(content)) {
    throw new tool_error(
      `'${file_path}' changed on disk since it was indexed; reindex the project before editing`,
    );
  }
  return content;
}

/** Write a project file, honoring the same containment rule as reads. */
export function write_project_file(root_path: string, file_path: string, content: string): void {
  writeFileSync(resolve_project_path(root_path, file_path), content, 'utf8');
}

/**
 * Start offset of every line, in content order. `offsets[i]` is where line
 * `i + 1` begins, so a position's offset is a constant-time lookup.
 */
export function build_line_offsets(content: string): readonly number[] {
  const offsets: number[] = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

/** 1-based `(line, column)` to a UTF-16 index into `content`. */
export function position_to_offset(offsets: readonly number[], line: number, column: number): number {
  const line_offset = offsets[line - 1] ?? 0;
  return line_offset + column - 1;
}
