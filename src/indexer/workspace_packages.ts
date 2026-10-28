/**
 * Monorepo workspace packages: resolving `@acme/shared` to a file in the repo.
 *
 * In a monorepo, `import { user } from '@acme/shared'` names another package
 * of the same repository, not something in node_modules. Treated as external,
 * every such import is a dead end, and "what breaks if I change this shared
 * type?" misses every app that uses it. So the packages are found the way
 * package managers find them: a `package.json` with a `name`, in a directory
 * that holds indexed source files.
 *
 * Only names declared by the repository's own `package.json` files resolve,
 * and only to files the index already holds. A package whose entry points at
 * a build output that is not indexed (`dist/index.js`) falls back to the usual
 * source layouts (`src/index.ts`, `index.ts`); if none exists, the import
 * stays unresolved rather than being pointed at a guess.
 */

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { resolve_path_candidate, type file_index } from '../extract/module_resolution.js';

export interface workspace_package {
  readonly name: string;
  /** POSIX directory of the package relative to the project root; `''` for the root. */
  readonly directory: string;
  /** Entry paths declared in package.json, relative to `directory`, most preferred first. */
  readonly entries: readonly string[];
}

/** Workspace packages keyed by their `name`. */
export type workspace_packages = ReadonlyMap<string, workspace_package>;

/**
 * Find every `package.json` in a directory that contains, or is an ancestor of,
 * an indexed file. Reading only those directories keeps this bounded by the
 * index, and keeps `node_modules` out: the scanner never indexes it.
 */
export function find_workspace_packages(root_path: string, files: file_index): workspace_packages {
  const directories = new Set<string>(['']);
  for (const file of files) {
    for (let directory = posix.dirname(file); directory !== '.' && !directories.has(directory);) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }

  const packages = new Map<string, workspace_package>();
  const claimed_twice = new Set<string>();
  for (const directory of directories) {
    const manifest = read_manifest(join(root_path, directory, 'package.json'));
    if (manifest === undefined || typeof manifest.name !== 'string' || manifest.name.length === 0) {
      continue;
    }
    if (packages.has(manifest.name)) {
      claimed_twice.add(manifest.name);
      continue;
    }
    packages.set(manifest.name, { name: manifest.name, directory, entries: entries_of(manifest) });
  }

  // Two packages claiming one name is a broken workspace; resolving to either
  // would be a guess, so neither is used.
  for (const name of claimed_twice) {
    packages.delete(name);
  }
  return packages;
}

/**
 * The indexed file a bare specifier names, when it is one of the workspace's
 * own packages (`@acme/shared` or a subpath like `@acme/shared/validation`).
 */
export function resolve_workspace_specifier(
  module_specifier: string,
  packages: workspace_packages,
  files: file_index,
): string | undefined {
  const name = package_name_of(module_specifier);
  if (name === undefined) {
    return undefined;
  }
  const item = packages.get(name);
  if (item === undefined) {
    return undefined;
  }

  const at = (relative: string): string => posix.normalize(posix.join(item.directory, relative));
  const subpath = module_specifier.slice(name.length).replace(/^\//, '');

  if (subpath.length > 0) {
    return (
      resolve_path_candidate(at(subpath), files) ??
      resolve_path_candidate(at(posix.join('src', subpath)), files)
    );
  }

  for (const entry of item.entries) {
    const found = resolve_path_candidate(at(entry), files);
    if (found !== undefined) {
      return found;
    }
  }
  return resolve_path_candidate(at('src/index'), files) ?? resolve_path_candidate(at('index'), files);
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`; relative or empty -> undefined. */
function package_name_of(specifier: string): string | undefined {
  if (specifier.length === 0 || specifier.startsWith('.') || specifier.startsWith('/')) {
    return undefined;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 && parts[1]!.length > 0 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0];
}

interface manifest {
  readonly name?: unknown;
  readonly types?: unknown;
  readonly typings?: unknown;
  readonly source?: unknown;
  readonly module?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
}

function read_manifest(path: string): manifest | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as manifest) : undefined;
  } catch {
    // Missing or not JSON: not a package.
    return undefined;
  }
}

/**
 * Declared entry points, preferring source-like ones. `exports["."]` may be a
 * string or a conditions object; its `types`, `source`, `import` and `default`
 * conditions are taken, in that order.
 */
function entries_of(manifest: manifest): string[] {
  const entries: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0 && !entries.includes(value)) {
      entries.push(value);
    }
  };

  add(manifest.source);
  add(manifest.types);
  add(manifest.typings);

  const root_export =
    typeof manifest.exports === 'object' && manifest.exports !== null && '.' in manifest.exports
      ? (manifest.exports as Record<string, unknown>)['.']
      : manifest.exports;
  if (typeof root_export === 'string') {
    add(root_export);
  } else if (typeof root_export === 'object' && root_export !== null) {
    const conditions = root_export as Record<string, unknown>;
    for (const key of ['types', 'source', 'import', 'default']) {
      add(conditions[key]);
    }
  }

  add(manifest.module);
  add(manifest.main);
  return entries;
}
