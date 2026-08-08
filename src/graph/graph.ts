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

/** Every file that pulls a module in, either by importing or re-exporting it. */
export function get_dependents(options: graph_options, file_path: string): dependents_result {
  const store = options.store;

  const by_file = new Map<string, dependent_accum>();
  for (const item of store.get_imports_resolved_to(file_path)) {
    let acc = by_file.get(item.file_path);
    if (acc === undefined) {
      acc = { kind: 'import', local_names: [], specifiers: [], line: item.line };
      by_file.set(item.file_path, acc);
    }
    push_unique(acc.local_names, item.local_name);
    push_unique(acc.specifiers, item.module_specifier);
    if (item.line < acc.line) {
      acc.line = item.line;
    }
  }

  // A re-exporting file (`export * from './user'`) depends on its source even
  // though it binds no name from it.
  const files: file_index = new Set(store.list_file_paths());
  for (const item of store.get_all_exports()) {
    if (item.kind !== 're_export' || item.module_specifier === undefined) {
      continue;
    }
    const target = resolve_module_specifier({
      from_file_path: item.file_path,
      module_specifier: item.module_specifier,
      files,
    });
    if (target !== file_path) {
      continue;
    }
    let acc = by_file.get(item.file_path);
    if (acc === undefined) {
      acc = { kind: 're_export', local_names: [], specifiers: [], line: item.line };
      by_file.set(item.file_path, acc);
    }
    push_unique(acc.specifiers, item.module_specifier);
    if (item.line < acc.line) {
      acc.line = item.line;
    }
  }

  const dependents = [...by_file.entries()]
    .map(([file_path, acc]) => ({ file_path, ...acc }))
    .sort((left, right) => left.file_path.localeCompare(right.file_path));
  return { dependents };
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
