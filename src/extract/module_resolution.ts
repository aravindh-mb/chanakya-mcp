/**
 * Resolving a module specifier to a file inside the project.
 *
 * This is deliberately a small resolver, because the package only needs to
 * answer one question: does this `./user` import refer to a file the index
 * knows about? It does not implement the full Node/TS resolution algorithm —
 * node_modules lookup, package.json `exports`, and type-only paths are out of
 * scope until a phase explicitly calls for them.
 *
 * Resolution is exactness-first and guesses only extension and `index` forms,
 * the two shapes TypeScript itself tries for a relative specifier.
 */

import { posix } from 'node:path';
import { is_internal_specifier } from '../model/module_graph.js';

/**
 * Every indexed path, as POSIX paths relative to the project root.
 *
 * A `Set` because it is only ever asked "does this path exist?" — resolution
 * is a membership check, not a lookup by key.
 */
export type file_index = ReadonlySet<string>;

/** Build a `file_index` from what the scanner found. */
export function build_file_index(files: readonly { relative_path: string }[]): file_index {
  return new Set(files.map((file) => file.relative_path));
}

/**
 * Extension probe order for `./user` -> `user.ts`.
 *
 * TypeScript prefers source files over declaration files, and `.ts` family
 * over `.js` family. The exact order only matters when two candidates coexist,
 * which is rare; the property that matters is that the choices are
 * deterministic.
 */
const CANDIDATE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
];

export interface resolve_module_specifier_options {
  /** POSIX path of the importing file, e.g. `src/app.ts`. */
  readonly from_file_path: string;
  /** Exactly as written, e.g. `./user`. */
  readonly module_specifier: string;
  /** The set of files available to resolve against. */
  readonly files: file_index;
}

/**
 * The indexed file a specifier points at, or `undefined`.
 *
 * Returns `undefined` for anything external (a bare package name, an absolute
 * URL) and for relative specifiers that match nothing. A specifier that names
 * a file that exists but was excluded from the index resolves to nothing, which
 * is the honest answer for an index that does not know it.
 */
export function resolve_module_specifier(options: resolve_module_specifier_options): string | undefined {
  const { from_file_path, module_specifier, files } = options;

  if (!is_internal_specifier(module_specifier)) {
    return undefined;
  }

  const from_directory = posix.dirname(from_file_path);
  const base = posix.normalize(posix.join(from_directory, module_specifier));

  if (files.has(base)) {
    return base;
  }

  for (const extension of CANDIDATE_EXTENSIONS) {
    if (files.has(base + extension)) {
      return base + extension;
    }
  }

  for (const extension of CANDIDATE_EXTENSIONS) {
    const index_file = posix.join(base, `index${extension}`);
    if (files.has(index_file)) {
      return index_file;
    }
  }

  return undefined;
}
