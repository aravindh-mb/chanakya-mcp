/**
 * Path helpers shared by the scanner, the indexer and (later) the patching layer.
 *
 * Two rules hold everywhere in this package:
 * 1. Absolute paths are native (backslashes on Windows) and used for filesystem access.
 * 2. Relative paths are POSIX-style (forward slashes) and used as stable identifiers
 *    in the index, in MCP responses and in `.gitignore` matching. They are the keys an
 *    agent sees, so they must not differ between operating systems.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Windows and macOS default to case-insensitive filesystems. */
const IS_CASE_INSENSITIVE_PLATFORM = process.platform === 'win32' || process.platform === 'darwin';

/** Convert a native path to POSIX separators. */
export function to_posix_path(value: string): string {
  return value.split(sep).join('/');
}

/**
 * Relative POSIX path from `root_path` to `absolute_path`.
 * Returns `undefined` when the target is not inside the root.
 */
export function to_relative_posix_path(root_path: string, absolute_path: string): string | undefined {
  if (!is_path_inside(root_path, absolute_path)) {
    return undefined;
  }
  const relative_path = relative(root_path, absolute_path);
  if (relative_path === '') {
    return '.';
  }
  return to_posix_path(relative_path);
}

/**
 * True when `candidate_path` is the root itself or lives underneath it.
 *
 * This is the containment check that keeps every later phase from reading or
 * writing outside the project. Both paths must already be absolute; callers
 * should pass symlink-resolved paths so a symlink cannot smuggle a target out
 * of the root.
 */
export function is_path_inside(root_path: string, candidate_path: string): boolean {
  if (!isAbsolute(root_path) || !isAbsolute(candidate_path)) {
    return false;
  }

  const root = strip_trailing_separator(resolve(root_path));
  const candidate = strip_trailing_separator(resolve(candidate_path));

  if (paths_equal(root, candidate)) {
    return true;
  }

  const prefix = root.endsWith(sep) ? root : root + sep;
  return paths_equal(candidate.slice(0, prefix.length), prefix);
}

function paths_equal(left: string, right: string): boolean {
  return IS_CASE_INSENSITIVE_PLATFORM ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function strip_trailing_separator(value: string): string {
  // Keep a root like `C:\` or `/` intact.
  if (value.length > 1 && value.endsWith(sep) && !value.endsWith(`:${sep}`)) {
    return value.slice(0, -1);
  }
  return value;
}
