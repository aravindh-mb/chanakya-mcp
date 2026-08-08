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

/**
 * Extension **substitutions**, which are different from the probes above.
 *
 * Under `"module": "NodeNext"` TypeScript requires the specifier to name the
 * *output* file: you write `import './user.js'` while the file on disk is
 * `user.ts`. This is not a stylistic choice, it is what the compiler mandates,
 * and it is how most modern TypeScript ESM projects — including this one — are
 * written.
 *
 * Appending extensions cannot resolve that, because `./user.js` is already a
 * complete-looking path: `user.js.ts` does not exist and the lookup fails. The
 * result is that on an entire class of real projects, no relative import
 * resolves and every cross-file relationship silently disappears. So the
 * written extension is swapped for the source extensions it could have come
 * from.
 */
const EXTENSION_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};

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

  // Before probing, try swapping a written output extension for its source
  // extension: `./user.js` -> `user.ts`. Checked ahead of the probes because
  // the specifier already carries an extension, so appending cannot match.
  const substituted = resolve_by_substitution(base, files);
  if (substituted !== undefined) {
    return substituted;
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

/** `./user.js` -> `user.ts`. See `EXTENSION_SUBSTITUTIONS`. */
function resolve_by_substitution(base: string, files: file_index): string | undefined {
  for (const [written, sources] of Object.entries(EXTENSION_SUBSTITUTIONS)) {
    if (!base.endsWith(written)) {
      continue;
    }

    const without_extension = base.slice(0, -written.length);
    for (const source of sources) {
      const candidate = without_extension + source;
      if (files.has(candidate)) {
        return candidate;
      }
    }

    // A specifier ending in `.js` names exactly one file. Once the written
    // extension is recognised, no other substitution applies.
    return undefined;
  }

  return undefined;
}
