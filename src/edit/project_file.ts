/**
 * Reading and writing project files for edit operations, plus the checks that
 * make an edit "safe".
 *
 * Three rules hold. First, the path must stay inside the project: a relative
 * POSIX path is resolved against the root and verified with the containment
 * check, so a crafted `..` cannot smuggle a write out of the tree. Second, the
 * containment check is repeated against **real paths**, so a symlink or junction
 * inside the project that points outside cannot smuggle a write out either —
 * the lexical check alone would accept `link/evil.ts` when `link` resolves
 * elsewhere. Third, the file's content on disk must still match what the index
 * recorded — an edit based on stale locations would silently clobber changes
 * made after the last index, so we refuse instead. The index refreshes on every
 * edit (via the `reindex` step), which is what keeps a second edit safe.
 */

import { realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { hash_content } from '../core/hash.js';
import { is_path_inside } from '../core/paths.js';
import { tool_error } from '../mcp/errors.js';
import type { index_store } from '../store/index_store.js';

/**
 * Resolve a project-relative POSIX path to an absolute native path, refusing
 * anything that escapes the project root, lexically or through a symlink.
 */
export function resolve_project_path(root_path: string, file_path: string): string {
  if (isAbsolute(file_path) || file_path.split('/').includes('..')) {
    throw new tool_error(`'${file_path}' is not a project-relative path`);
  }
  const absolute_path = resolve(root_path, file_path);
  if (!is_path_inside(root_path, absolute_path)) {
    throw new tool_error(`'${file_path}' resolves outside the project`);
  }
  assert_real_path_inside(root_path, absolute_path);
  return absolute_path;
}

/**
 * Re-run the containment check on real paths, so a symlink cannot smuggle the
 * target out of the root.
 *
 * The candidate may not exist yet (it is about to be written), so the nearest
 * existing ancestor is resolved instead — a symlinked directory ancestor is
 * caught either way, which is the only direction a path can escape.
 */
function assert_real_path_inside(root_path: string, candidate_path: string): void {
  const real_root = try_realpath(root_path);
  if (real_root === undefined) {
    // The root does not exist or is unreadable; nothing to verify against, and
    // the lexical check above is all the defense a phantom root needs.
    return;
  }

  let probe = candidate_path;
  let real_probe = try_realpath(probe);
  while (real_probe === undefined) {
    const parent = dirname(probe);
    if (parent === probe) {
      // Walked up to the drive root without finding anything: nothing to verify.
      return;
    }
    probe = parent;
    real_probe = try_realpath(probe);
  }

  if (!is_path_inside(real_root, real_probe)) {
    throw new tool_error(`'${candidate_path}' resolves outside the project through a symlink`);
  }
}

function try_realpath(path_value: string): string | undefined {
  try {
    return realpathSync.native(path_value);
  } catch {
    return undefined;
  }
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
