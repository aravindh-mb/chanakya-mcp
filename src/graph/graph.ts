/**
 * Module-level dependency queries.
 *
 * Navigation resolves within a symbol; these resolve across modules. A file
 * "depends on" every module it imports, and is "depended on" by every file
 * that imports it or re-exports from it. Both answers come straight off the
 * indexed import and export rows — no re-parsing, no file reads.
 *
 * Dependencies are grouped by target so `import { a } from './x'` and
 * `import { b } from './x'` read as one dependency on `./x`, and a package
 * imported from several lines reads as one dependency on that package. The
 * grouping is exact, not fuzzy: an import resolves to a project file only when
 * the specifier resolved during the graph pass, so a package never masquerades
 * as a file and an unresolvable import is reported as the specifier it is.
 */

import type { code_import } from '../model/module_graph.js';
import { resolve_module_specifier, type file_index } from '../extract/module_resolution.js';
import type { index_store } from '../store/index_store.js';
import type { dependencies_result, dependents_result, dependency_hit } from './types.js';

export interface graph_options {
  readonly store: index_store;
}

interface dependency_accum {
  readonly is_internal: boolean;
  readonly resolved: boolean;
  readonly local_names: string[];
  readonly specifiers: string[];
  line: number;
}

interface dependent_accum {
  kind: 'import' | 're_export';
  readonly local_names: string[];
  readonly specifiers: string[];
  line: number;
  via?: string;
}

/** How many barrels deep to follow re-exports before stopping. */
const MAX_BARREL_DEPTH = 8;

/** A file that re-exports from some target: `export * from './types'`. */
interface re_exporter {
  readonly file_path: string;
  readonly specifier: string;
  readonly line: number;
}

/** Every module a file pulls in, grouped by target. */
export function get_dependencies(options: graph_options, file_path: string): dependencies_result {
  const dependencies = group_imports(
    options.store.get_imports_in_file(file_path),
    (item) => item.resolved_path ?? item.module_specifier,
  );
  dependencies.sort((left, right) => left.target.localeCompare(right.target));
  return { dependencies };
}

/**
 * Every file that pulls a module in: by importing it, by re-exporting it, or
 * by importing it through a re-exporting barrel.
 *
 * The barrel case is what makes "what breaks if I change this file?" honest in
 * a monorepo, where apps import `@acme/shared` and never name
 * `shared/src/types.ts` directly. It is followed precisely: a file reached
 * through a barrel is listed only when it binds a name the target itself
 * exports, or takes the whole module (a namespace import, `require`, dynamic
 * `import()`). A file importing only some other module's names from the same
 * barrel does not depend on the target and is not listed.
 */
export function get_dependents(options: graph_options, file_path: string): dependents_result {
  const store = options.store;
  const re_exporters = re_exporters_by_target(store);

  const by_file = new Map<string, dependent_accum>();
  for (const item of store.get_imports_resolved_to(file_path)) {
    add_import(by_file, item, undefined);
  }
  // A re-exporting file (`export * from './user'`) depends on its source even
  // though it binds no name from it.
  for (const item of re_exporters.get(file_path) ?? []) {
    add_re_export(by_file, item, undefined);
  }

  // Follow the barrels outwards, breadth first, so the nearest barrel is the
  // one reported as `via`.
  const target_names = new Set(store.get_exports_in_file(file_path).map((item) => item.exported_name));
  const visited = new Set<string>([file_path]);
  let barrels = (re_exporters.get(file_path) ?? []).map((item) => item.file_path);
  for (const barrel of barrels) {
    visited.add(barrel);
  }
  for (let depth = 0; depth < MAX_BARREL_DEPTH && barrels.length > 0; depth += 1) {
    const next: string[] = [];
    for (const barrel of barrels) {
      for (const item of store.get_imports_resolved_to(barrel)) {
        if (item.file_path !== file_path && binds_from_target(item, target_names)) {
          add_import(by_file, item, barrel);
        }
      }
      for (const item of re_exporters.get(barrel) ?? []) {
        if (visited.has(item.file_path)) {
          continue;
        }
        visited.add(item.file_path);
        add_re_export(by_file, item, barrel);
        next.push(item.file_path);
      }
    }
    barrels = next;
  }

  const dependents = [...by_file.entries()]
    .map(([path, acc]) => {
      const { via, ...rest } = acc;
      return via === undefined ? { file_path: path, ...rest } : { file_path: path, ...rest, via };
    })
    .sort((left, right) => left.file_path.localeCompare(right.file_path));
  return { dependents };
}

/** Every file that re-exports from each target, keyed by the target's path. */
function re_exporters_by_target(store: index_store): Map<string, re_exporter[]> {
  const files: file_index = new Set(store.list_file_paths());
  const by_target = new Map<string, re_exporter[]>();
  for (const item of store.get_all_exports()) {
    if (item.kind !== 're_export' || item.module_specifier === undefined) {
      continue;
    }
    const target = resolve_module_specifier({
      from_file_path: item.file_path,
      module_specifier: item.module_specifier,
      files,
    });
    if (target === undefined) {
      continue;
    }
    const bucket = by_target.get(target);
    const entry = { file_path: item.file_path, specifier: item.module_specifier, line: item.line };
    if (bucket === undefined) {
      by_target.set(target, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return by_target;
}

/** Whether an import of a barrel takes anything the target exports. */
function binds_from_target(item: code_import, target_names: ReadonlySet<string>): boolean {
  switch (item.kind) {
    case 'namespace':
    case 'require':
    case 'dynamic':
      return true;
    case 'default':
      return target_names.has('default');
    case 'named':
      return item.imported_name !== undefined && target_names.has(item.imported_name);
    case 'side_effect':
      return false;
  }
}

function add_import(by_file: Map<string, dependent_accum>, item: code_import, via: string | undefined): void {
  let acc = by_file.get(item.file_path);
  if (acc === undefined) {
    acc = {
      kind: 'import',
      local_names: [],
      specifiers: [],
      line: item.line,
      ...(via === undefined ? {} : { via }),
    };
    by_file.set(item.file_path, acc);
  } else if (acc.via !== via) {
    // Already a dependent by a nearer route; the nearest one is reported.
    return;
  }
  push_unique(acc.local_names, item.local_name);
  push_unique(acc.specifiers, item.module_specifier);
  if (item.line < acc.line) {
    acc.line = item.line;
  }
}

function add_re_export(
  by_file: Map<string, dependent_accum>,
  item: re_exporter,
  via: string | undefined,
): void {
  let acc = by_file.get(item.file_path);
  if (acc === undefined) {
    acc = {
      kind: 're_export',
      local_names: [],
      specifiers: [],
      line: item.line,
      ...(via === undefined ? {} : { via }),
    };
    by_file.set(item.file_path, acc);
  } else if (acc.via !== via) {
    return;
  }
  push_unique(acc.specifiers, item.specifier);
  if (item.line < acc.line) {
    acc.line = item.line;
  }
}

function group_imports(
  imports: readonly code_import[],
  target_for: (item: code_import) => string,
): dependency_hit[] {
  const by_target = new Map<string, dependency_accum>();
  for (const item of imports) {
    const target = target_for(item);
    let acc = by_target.get(target);
    if (acc === undefined) {
      acc = {
        is_internal: item.is_internal,
        resolved: item.resolved_path !== undefined,
        local_names: [],
        specifiers: [],
        line: item.line,
      };
      by_target.set(target, acc);
    }
    push_unique(acc.local_names, item.local_name);
    push_unique(acc.specifiers, item.module_specifier);
    if (item.line < acc.line) {
      acc.line = item.line;
    }
  }

  return [...by_target.entries()].map(([target, acc]) => ({ target, ...acc }));
}

/** Append `value` to `bucket` when it is defined and not already present. */
function push_unique(bucket: string[], value: string | undefined): void {
  if (value === undefined || bucket.includes(value)) {
    return;
  }
  bucket.push(value);
}
