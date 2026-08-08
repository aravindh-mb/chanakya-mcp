/**
 * Exclusion rules for the scanner.
 *
 * Two independent layers:
 *
 * 1. Built-in directory/pattern denylist. Always applied, cheap, and enough on
 *    its own for projects without a `.gitignore`.
 * 2. `.gitignore` files. Honoured per directory, git-style: a `.gitignore`
 *    applies to its own directory and everything below it.
 *
 * The gitignore layer uses the `ignore` package rather than a hand written glob
 * matcher. Gitignore syntax has enough corner cases (negation, anchoring,
 * `**` semantics, trailing-slash directory matching) that a bespoke matcher
 * would quietly get files wrong, and a wrong exclusion means an agent is told a
 * symbol does not exist.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore_module, { type Ignore } from 'ignore';

/**
 * `ignore` is CommonJS with an ESM-style `.d.ts`, so under `module: NodeNext` a
 * default import resolves to the module namespace rather than the factory. The
 * package assigns `factory.default = factory` for exactly this case, so reading
 * `.default` is correct both for the type checker and at runtime.
 */
const create_ignore_matcher = ignore_module.default;

/**
 * Directories never descended into. Matched by exact directory name at any depth.
 * Callers may replace this list entirely via `scan_options.ignored_directories`.
 */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.expo',
  '.vercel',
  '.netlify',
  '.yarn',
  '.pnpm-store',
  '.code-intelligence',
];

/**
 * Files excluded by pattern. Generated bundles parse fine but produce thousands
 * of meaningless symbols, so they are excluded by default.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  '**/*.min.js',
  '**/*.min.mjs',
  '**/*.min.cjs',
  '**/*.bundle.js',
  '**/*.map',
];

export const GITIGNORE_FILE_NAME = '.gitignore';

/**
 * One `.gitignore` file, bound to the directory it was found in.
 * `base_relative_path` is `''` for the project root, otherwise a POSIX path
 * such as `apps/web`.
 */
export interface ignore_layer {
  readonly base_relative_path: string;
  readonly matcher: Ignore;
}

/** Read a `.gitignore` from `directory_path`, or `undefined` when absent/unreadable. */
export async function load_ignore_layer(
  directory_path: string,
  base_relative_path: string,
): Promise<ignore_layer | undefined> {
  let content: string;
  try {
    content = await readFile(join(directory_path, GITIGNORE_FILE_NAME), 'utf8');
  } catch {
    // A missing .gitignore is the normal case, not an error worth reporting.
    return undefined;
  }

  const matcher = create_ignore_matcher().add(content);
  return { base_relative_path, matcher };
}

/** Build a matcher for explicitly configured patterns, relative to the project root. */
export function create_pattern_layer(patterns: readonly string[]): ignore_layer | undefined {
  if (patterns.length === 0) {
    return undefined;
  }
  return { base_relative_path: '', matcher: create_ignore_matcher().add([...patterns]) };
}

/**
 * Test a project-relative POSIX path against every applicable layer.
 *
 * `is_directory` matters: gitignore patterns ending in `/` only match
 * directories, and the `ignore` package expects a trailing slash to signal that.
 */
export function is_ignored(
  layers: readonly ignore_layer[],
  relative_path: string,
  is_directory: boolean,
): boolean {
  // The project root itself is never ignorable, and `./` is not a path the
  // matcher accepts. A symlink pointing at the root canonicalizes to `.`.
  if (relative_path === '' || relative_path === '.') {
    return false;
  }

  for (const layer of layers) {
    const scoped_path = scope_to_layer(layer.base_relative_path, relative_path);
    if (scoped_path === undefined) {
      continue;
    }
    if (layer.matcher.ignores(is_directory ? `${scoped_path}/` : scoped_path)) {
      return true;
    }
  }
  return false;
}

/**
 * Re-express a root-relative path as relative to a layer's base directory.
 * Returns `undefined` when the path is outside that layer's scope.
 */
function scope_to_layer(base_relative_path: string, relative_path: string): string | undefined {
  if (base_relative_path === '') {
    return relative_path;
  }
  const prefix = `${base_relative_path}/`;
  if (!relative_path.startsWith(prefix)) {
    return undefined;
  }
  return relative_path.slice(prefix.length);
}
