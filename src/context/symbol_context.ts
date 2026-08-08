/**
 * A symbol's working context, gathered in one call.
 *
 * Navigation, graph and search each answer one question; an agent starting on
 * a task usually wants them all at once: what is this symbol, what contains it
 * and what it contains, how heavily it is used, who calls it, what it calls,
 * and what its file pulls in and is pulled in by. That is what
 * `get_symbol_context` returns — a compact bundle of the index's facts about
 * the symbol, every list capped and every entry a location or a name, never
 * file contents.
 *
 * It is assembled from the same queries as the individual tools rather than
 * re-implemented: the four navigation/graph functions are called directly on
 * the store, so the answers cannot disagree with what the other tools report.
 */

import { get_dependencies, get_dependents } from '../graph/graph.js';
import { tool_error } from '../mcp/errors.js';
import type { code_symbol, symbol_kind } from '../model/symbol.js';
import { find_callers, find_callees, find_references } from '../navigation/navigation.js';
import type { index_store } from '../store/index_store.js';

export interface symbol_context_options {
  readonly store: index_store;
}

/** A symbol as referenced from elsewhere in the context bundle. */
export interface context_symbol_ref {
  readonly id: string;
  readonly name: string;
  readonly kind: symbol_kind;
  readonly file_path: string;
  readonly signature?: string | undefined;
}

export interface context_call {
  /** The other symbol, when the edge resolved. */
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly file_path: string;
  readonly line: number;
  readonly confidence: 'certain' | 'resolved';
}

export interface context_reference_file {
  readonly file_path: string;
  readonly count: number;
}

export interface context_dependent {
  readonly file_path: string;
  readonly kind: 'import' | 're_export';
}

export interface symbol_context_result {
  readonly symbol: {
    readonly id: string;
    readonly name: string;
    readonly kind: symbol_kind;
    readonly file_path: string;
    readonly start_line: number;
    readonly start_column: number;
    readonly end_line: number;
    readonly end_column: number;
    readonly signature?: string | undefined;
    readonly export_kind: 'none' | 'named' | 'default';
    readonly is_ambient: boolean;
  };
  /** Where the symbol sits in its file, and what sits inside it. */
  readonly container: {
    readonly parents: readonly context_symbol_ref[];
    readonly members: readonly context_symbol_ref[];
    readonly members_truncated: boolean;
  };
  /** How heavily the symbol is used, grouped by file. */
  readonly references: {
    readonly total: number;
    readonly uses: number;
    readonly distinct_files: number;
    readonly files: readonly context_reference_file[];
    readonly files_truncated: boolean;
  };
  readonly callers: {
    readonly total: number;
    readonly items: readonly context_call[];
    readonly truncated: boolean;
  };
  readonly callees: {
    readonly total: number;
    readonly items: readonly context_call[];
    readonly truncated: boolean;
  };
  /** What the symbol's file imports, and what imports or re-exports it. */
  readonly module: {
    readonly internal_dependencies: readonly string[];
    readonly packages: readonly string[];
    readonly unresolvable_specifiers: readonly string[];
    readonly dependents: readonly context_dependent[];
    readonly truncated: boolean;
  };
}

const MAX_CALLS = 50;
const MAX_REFERENCE_FILES = 25;
const MAX_MEMBERS = 50;
const MAX_MODULE_ITEMS = 50;

export function get_symbol_context(options: symbol_context_options, symbol_id: string): symbol_context_result {
  const { store } = options;

  const symbol = store.get_symbol(symbol_id);
  if (symbol === undefined) {
    throw new tool_error(`no symbol with id '${symbol_id}'`);
  }

  return {
    symbol: {
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      file_path: symbol.file_path,
      start_line: symbol.start_line,
      start_column: symbol.start_column,
      end_line: symbol.end_line,
      end_column: symbol.end_column,
      ...(symbol.signature === undefined ? {} : { signature: symbol.signature }),
      export_kind: symbol.export_kind,
      is_ambient: symbol.is_ambient,
    },
    container: {
      parents: parent_chain(store, symbol),
      members: members_of(store, symbol).items,
      members_truncated: members_of(store, symbol).truncated,
    },
    references: references_summary(store, symbol_id),
    callers: callers_summary(store, symbol_id),
    callees: callees_summary(store, symbol_id),
    module: module_summary(store, symbol.file_path),
  };
}

function parent_chain(store: index_store, symbol: code_symbol): readonly context_symbol_ref[] {
  const parents: context_symbol_ref[] = [];
  let current = symbol.parent_id;
  while (current !== undefined) {
    const parent = store.get_symbol(current);
    if (parent === undefined) {
      break;
    }
    parents.unshift(to_ref(parent));
    current = parent.parent_id;
  }
  return parents;
}

function members_of(store: index_store, symbol: code_symbol): { items: readonly context_symbol_ref[]; truncated: boolean } {
  const members = [...store.get_symbols_by_parent(symbol.id)]
    .sort((left, right) => left.start_line - right.start_line)
    .map(to_ref);
  return { items: members.slice(0, MAX_MEMBERS), truncated: members.length > MAX_MEMBERS };
}

function references_summary(
  store: index_store,
  symbol_id: string,
): symbol_context_result['references'] {
  const references = find_references({ store }, symbol_id).references;

  const by_file = new Map<string, number>();
  let definitions = 0;
  for (const reference of references) {
    by_file.set(reference.file_path, (by_file.get(reference.file_path) ?? 0) + 1);
    if (reference.is_definition) {
      definitions += 1;
    }
  }

  const files = [...by_file.entries()]
    .map(([file_path, count]) => ({ file_path, count }))
    .sort((left, right) => right.count - left.count || left.file_path.localeCompare(right.file_path));

  return {
    total: references.length,
    uses: references.length - definitions,
    distinct_files: by_file.size,
    files: files.slice(0, MAX_REFERENCE_FILES),
    files_truncated: files.length > MAX_REFERENCE_FILES,
  };
}

function callers_summary(store: index_store, symbol_id: string): symbol_context_result['callers'] {
  const callers = find_callers({ store }, symbol_id).callers.map((caller) => ({
    ...(caller.caller === undefined ? {} : { id: caller.caller.id, name: caller.caller.name }),
    file_path: caller.file_path,
    line: caller.line,
    confidence: caller.confidence,
  }));
  return {
    total: callers.length,
    items: callers.slice(0, MAX_CALLS),
    truncated: callers.length > MAX_CALLS,
  };
}

function callees_summary(store: index_store, symbol_id: string): symbol_context_result['callees'] {
  const callees = find_callees({ store }, symbol_id).callees.map((callee) => ({
    ...(callee.callee === undefined ? {} : { id: callee.callee.id }),
    name: callee.callee_name,
    file_path: callee.file_path,
    line: callee.line,
    confidence: callee.confidence,
  }));
  return {
    total: callees.length,
    items: callees.slice(0, MAX_CALLS),
    truncated: callees.length > MAX_CALLS,
  };
}

function module_summary(
  store: index_store,
  file_path: string,
): symbol_context_result['module'] {
  const dependencies = get_dependencies({ store }, file_path).dependencies;
  const internal_dependencies: string[] = [];
  const packages: string[] = [];
  const unresolvable_specifiers: string[] = [];
  for (const dependency of dependencies) {
    if (dependency.is_internal) {
      if (dependency.resolved) {
        internal_dependencies.push(dependency.target);
      } else {
        unresolvable_specifiers.push(dependency.target);
      }
    } else {
      packages.push(dependency.target);
    }
  }

  const dependents = get_dependents({ store }, file_path).dependents.map((dependent) => ({
    file_path: dependent.file_path,
    kind: dependent.kind,
  }));

  const truncated =
    internal_dependencies.length > MAX_MODULE_ITEMS ||
    packages.length > MAX_MODULE_ITEMS ||
    dependents.length > MAX_MODULE_ITEMS;

  return {
    internal_dependencies: internal_dependencies.slice(0, MAX_MODULE_ITEMS),
    packages: packages.slice(0, MAX_MODULE_ITEMS),
    unresolvable_specifiers: unresolvable_specifiers.slice(0, MAX_MODULE_ITEMS),
    dependents: dependents.slice(0, MAX_MODULE_ITEMS),
    truncated,
  };
}

function to_ref(symbol: code_symbol): context_symbol_ref {
  return {
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    file_path: symbol.file_path,
    ...(symbol.signature === undefined ? {} : { signature: symbol.signature }),
  };
}
