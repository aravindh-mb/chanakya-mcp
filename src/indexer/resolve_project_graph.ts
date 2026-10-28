/**
 * The cross-file graph resolution pass.
 *
 * Per-file extraction resolves names against the file's own symbols; anything
 * else stays unresolved. This pass runs once all files are indexed, reads the
 * whole module graph out of the store, and follows imports to point every
 * unresolved call edge at the symbol it actually calls.
 *
 * A chain such as `user_service.create_user()` is resolved in two halves. The
 * first segment must be an import binding in the edge's own file; the import
 * names a target file and an exported name. The remaining segments then walk
 * down the exported symbol's own members. Re-exports (`export { a } from`,
 * `export * from`) are followed with a bounded depth.
 *
 * Resolution is strictly additive and idempotent: only edges with no target
 * are touched, so re-running the pass after an incremental index is harmless.
 * The rule from `relationship.ts` still holds — nothing is ever guessed. An
 * edge whose import does not resolve, or whose member chain has no unique
 * target, stays unresolved.
 */

import type { logger } from '../core/logger.js';
import type { code_export, code_import } from '../model/module_graph.js';
import type { relationship } from '../model/relationship.js';
import type { code_symbol } from '../model/symbol.js';
import { resolve_module_specifier, type file_index } from '../extract/module_resolution.js';
import type { index_store } from '../store/index_store.js';
import { find_workspace_packages, resolve_workspace_specifier } from './workspace_packages.js';

/** How far to chase re-export chains before giving up. */
const MAX_RE_EXPORT_DEPTH = 8;

/** Import bindings per page. Each page's candidate rows are read in one query. */
const IMPORT_PAGE_SIZE = 2_000;

/**
 * Yield the candidate rows for every page of import bindings. Only a row that
 * names an import binding in its own file can resolve, so the bindings drive
 * the walk; `fetch` returns the rows for the bindings with keys in
 * (`after_key`, `last_key`].
 */
function* by_import_page<row_type>(
  store: index_store,
  fetch: (after_key: number, last_key: number) => readonly row_type[],
): Generator<row_type> {
  let after = 0;
  for (;;) {
    const last = store.next_import_page_end(after, IMPORT_PAGE_SIZE);
    if (last === undefined) {
      return;
    }
    yield* fetch(after, last);
    after = last;
  }
}

export interface resolve_project_graph_options {
  readonly store: index_store;
  readonly logger?: logger;
  /**
   * The project root on disk. When given, bare imports of the repository's own
   * workspace packages (`@acme/shared`) are resolved to their files; see
   * `workspace_packages.ts`.
   */
  readonly root_path?: string;
}

export interface resolve_project_graph_result {
  /** Edges pointed at a real symbol by this pass. */
  readonly edges_resolved: number;
  /** Imports whose specifier was resolved to a file by this pass. */
  readonly imports_resolved: number;
  /** References pointed at the symbol they turn out to name. */
  readonly references_resolved: number;
}

export function resolve_project_graph(options: resolve_project_graph_options): resolve_project_graph_result {
  const { store } = options;
  const log = options.logger;

  let imports_resolved = 0;
  let edges_resolved = 0;
  let references_resolved = 0;

  store.transaction(() => {
    const files: file_index = new Set(store.list_file_paths());
    const packages =
      options.root_path === undefined ? undefined : find_workspace_packages(options.root_path, files);

    // Imports: fill in any specifier resolution the per-file extractor could
    // not do (it may have run without the full file set), then index by file.
    const imports_by_file = new Map<string, code_import[]>();
    for (const item of store.get_all_imports()) {
      let resolved = item;
      if (resolved.resolved_path === undefined) {
        const target = item.is_internal
          ? resolve_module_specifier({
              from_file_path: item.file_path,
              module_specifier: item.module_specifier,
              files,
            })
          : packages === undefined
            ? undefined
            : resolve_workspace_specifier(item.module_specifier, packages, files);
        if (target !== undefined) {
          store.set_import_resolved_path(item.id!, target);
          resolved = { ...item, resolved_path: target };
          imports_resolved += 1;
        }
      }
      push(imports_by_file, resolved.file_path, resolved);
    }

    const exports_by_file = new Map<string, code_export[]>();
    for (const item of store.get_all_exports()) {
      push(exports_by_file, item.file_path, item);
    }

    // Paged rather than loaded whole: on a large repository the unresolved rows
    // number in the millions, and holding them all at once cost gigabytes.
    for (const edge of by_import_page(store, (after, last) => store.get_resolvable_call_edges(after, last))) {
      const target = resolve_edge_target(edge, files, imports_by_file, exports_by_file, store);
      if (target !== undefined) {
        // The id is assigned by the store and always present on a read row.
        store.set_edge_target(edge.id!, target);
        edges_resolved += 1;
      }
    }

    for (const reference of by_import_page(store, (after, last) =>
      store.get_resolvable_references(after, last),
    )) {
      const target = resolve_reference_target(
        reference.name,
        reference.file_path,
        files,
        imports_by_file,
        exports_by_file,
      );
      if (target !== undefined) {
        store.set_reference_target(reference.id!, target);
        references_resolved += 1;
      }
    }
  });

  log?.debug(
    `graph resolution: ${edges_resolved} edges, ${references_resolved} references, ` +
      `${imports_resolved} imports resolved`,
  );
  return { edges_resolved, imports_resolved, references_resolved };
}

function resolve_edge_target(
  edge: relationship,
  files: file_index,
  imports_by_file: ReadonlyMap<string, readonly code_import[]>,
  exports_by_file: ReadonlyMap<string, readonly code_export[]>,
  store: index_store,
): string | undefined {
  const from_file = edge.file_path;
  const written = edge.to_name.split('.');
  // A typed receiver is a local value, so its declared type replaces it: the
  // written name may even shadow an import, and must not be followed.
  // `service.create_user` becomes `user_service.create_user`, and
  // `this.orders.list` becomes `order_repository.list`.
  const segments =
    edge.receiver_type === undefined
      ? written
      : [edge.receiver_type, ...written.slice(written[0] === 'this' ? 2 : 1)];
  const binding = segments[0] as string;

  const imports = imports_by_file.get(from_file) ?? [];
  const found = imports.find((item) => item.local_name === binding);
  if (found === undefined) {
    return undefined;
  }

  const target_file = found.resolved_path;
  if (target_file === undefined) {
    return undefined;
  }

  // A namespace import binds the module object itself; the first useful name
  // is the next segment.
  let exported_name: string | undefined;
  let member_segments: readonly string[];
  if (found.kind === 'namespace') {
    exported_name = segments[1];
    member_segments = segments.slice(2);
  } else {
    exported_name = found.imported_name ?? binding;
    member_segments = segments.slice(1);
  }
  if (exported_name === undefined) {
    return undefined;
  }

  const base = resolve_exported_name(target_file, exported_name, files, exports_by_file, new Set(), 0);
  if (base === undefined) {
    return undefined;
  }

  return walk_members(store, base, member_segments);
}

/**
 * Resolve a bare-name reference across files by following its import.
 *
 * Member accesses are deliberately excluded: the reference table stores the
 * leaf name (`method` in `svc.method`) but not the chain that led to it, so
 * nothing honest can be concluded from the row alone. A bare name that the
 * file imports, though, names exactly one exported symbol.
 */
function resolve_reference_target(
  name: string,
  file_path: string,
  files: file_index,
  imports_by_file: ReadonlyMap<string, readonly code_import[]>,
  exports_by_file: ReadonlyMap<string, readonly code_export[]>,
): string | undefined {
  const imports = imports_by_file.get(file_path) ?? [];
  const found = imports.find((item) => item.local_name === name);
  if (found === undefined || found.kind === 'namespace') {
    return undefined;
  }

  const target_file = found.resolved_path;
  if (target_file === undefined) {
    return undefined;
  }

  return resolve_exported_name(
    target_file,
    found.imported_name ?? name,
    files,
    exports_by_file,
    new Set(),
    0,
  );
}

/**
 * The symbol id a file exports under a given name, following re-exports.
 *
 * Local exports win over re-exports, mirroring how explicit exports shadow
 * `export *`. A re-export is chased through its module specifier, and the
 * visited set plus the depth limit keep `export *` cycles from looping.
 */
function resolve_exported_name(
  file_path: string,
  exported_name: string,
  files: file_index,
  exports_by_file: ReadonlyMap<string, readonly code_export[]>,
  visited: Set<string>,
  depth: number,
): string | undefined {
  if (depth > MAX_RE_EXPORT_DEPTH) {
    return undefined;
  }

  const key = `${file_path}::${exported_name}`;
  if (visited.has(key)) {
    return undefined;
  }
  visited.add(key);

  const exports = exports_by_file.get(file_path) ?? [];

  const local = exports.find(
    (item) =>
      item.exported_name === exported_name && item.kind !== 're_export' && item.symbol_id !== undefined,
  );
  if (local !== undefined) {
    return local.symbol_id;
  }

  // An explicit re-export of this exact name: `export { a as b } from 'm'`.
  for (const item of exports) {
    if (
      item.kind !== 're_export' ||
      item.exported_name !== exported_name ||
      item.module_specifier === undefined
    ) {
      continue;
    }
    const next = resolve_specifier(file_path, item.module_specifier, files);
    if (next === undefined) {
      continue;
    }
    const target = resolve_exported_name(next, exported_name, files, exports_by_file, visited, depth + 1);
    if (target !== undefined) {
      return target;
    }
  }

  // Star re-exports: `export * from 'm'` re-exports everything from `m`.
  for (const item of exports) {
    if (item.kind !== 're_export' || item.exported_name !== '*' || item.module_specifier === undefined) {
      continue;
    }
    const next = resolve_specifier(file_path, item.module_specifier, files);
    if (next === undefined) {
      continue;
    }
    const target = resolve_exported_name(next, exported_name, files, exports_by_file, visited, depth + 1);
    if (target !== undefined) {
      return target;
    }
  }

  return undefined;
}

function resolve_specifier(
  from_file_path: string,
  module_specifier: string,
  files: file_index,
): string | undefined {
  return resolve_module_specifier({ from_file_path, module_specifier, files });
}

/** Walk the member chain of a symbol, requiring each step to resolve. */
function walk_members(
  store: index_store,
  symbol_id: string,
  segments: readonly string[],
): string | undefined {
  let current: code_symbol | undefined = store.get_symbol(symbol_id);
  for (const segment of segments) {
    if (current === undefined) {
      return undefined;
    }
    const children = store.get_symbols_by_parent(current.id);
    const match = unique_match(children, segment);
    current = match;
  }
  return current?.id;
}

/** The unique symbol with this name among `symbols`, or the first of several. */
function unique_match(symbols: readonly code_symbol[], name: string): code_symbol | undefined {
  const matches = symbols.filter((symbol) => symbol.name === name);
  return matches[0];
}

function push<value>(map: Map<string, value[]>, key: string, item: value): void {
  const bucket = map.get(key);
  if (bucket === undefined) {
    map.set(key, [item]);
  } else {
    bucket.push(item);
  }
}
