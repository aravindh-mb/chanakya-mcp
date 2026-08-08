/**
 * Code navigation over the resolved graph.
 *
 * Four questions, each answered with locations rather than source:
 * where is a symbol declared, what mentions it, who calls it, and what does it
 * call. They are the find_definition / find_references / get_callers /
 * get_callees tools of the MCP surface, and they run directly against the
 * index — no re-parsing, no file reads.
 *
 * Caller and callee resolution follows edges both directions. An edge's
 * `from_id` is the innermost symbol enclosing the call site (or the file, for
 * top-level calls), and its `to_id` is the called symbol once resolution has
 * pointed the edge at it.
 */

import type { index_store } from '../store/index_store.js';
import type {
  callee_hit,
  caller_hit,
  find_callees_result,
  find_callers_result,
  find_definition_result,
  find_references_result,
} from './types.js';
import type { code_reference } from '../model/module_graph.js';

export interface navigation_options {
  readonly store: index_store;
}

/** Where a symbol is declared. */
export function find_definition(options: navigation_options, symbol_id: string): find_definition_result {
  return { symbol: options.store.get_symbol(symbol_id) };
}

/** Every indexed occurrence of a symbol, definition included. */
export function find_references(options: navigation_options, symbol_id: string): find_references_result {
  const store = options.store;

  // Get the symbol we're searching for (to extract its name)
  const target_symbol = store.get_symbol(symbol_id);
  if (target_symbol === undefined) {
    return { references: [] };
  }

  // Get exact resolved references (where symbol_id matches)
  const exact_references = store.get_references_to(symbol_id);

  // ALSO get all references by name (resolved or not) to catch:
  // - Unresolved cross-file uses
  // - Type annotation uses
  // - Import/export aliases
  // - All semantic variations of the name
  const all_by_name = store.find_references_by_name(target_symbol.name);

  // Combine: exact matches + all name matches (but deduplicate by location)
  const location_key = (ref: code_reference) => `${ref.file_path}:${ref.line}:${ref.column}`;
  const seen = new Set(exact_references.map(location_key));
  const references = [
    ...exact_references,
    ...all_by_name.filter((ref) => !seen.has(location_key(ref))),
  ];

  const enclosing_ids = [
    ...new Set(
      references.flatMap((item) =>
        item.enclosing_symbol_id === undefined ? [] : [item.enclosing_symbol_id],
      ),
    ),
  ];
  const symbols_by_id = new Map(store.get_symbols_by_ids(enclosing_ids).map((symbol) => [symbol.id, symbol]));

  return {
    references: references.map((item) => ({
      file_path: item.file_path,
      line: item.line,
      column: item.column,
      is_definition: item.is_definition,
      resolved: item.symbol_id === symbol_id,
      ...(item.enclosing_symbol_id === undefined
        ? {}
        : { enclosing_symbol: symbols_by_id.get(item.enclosing_symbol_id) }),
    })),
  };
}

/** The symbols whose bodies call a symbol, and where. */
export function find_callers(options: navigation_options, symbol_id: string): find_callers_result {
  const store = options.store;
  const edges = store.get_relationships_to(symbol_id);
  const callers: caller_hit[] = [];

  for (const edge of edges) {
    if (edge.kind !== 'calls') {
      continue;
    }
    callers.push({
      caller: is_symbol_id(edge.from_id) ? store.get_symbol(edge.from_id) : undefined,
      file_path: edge.file_path,
      line: edge.line,
      confidence: edge.confidence,
    });
  }

  callers.sort(by_location);
  return { callers };
}

/** The symbols a symbol calls, and where. */
export function find_callees(options: navigation_options, symbol_id: string): find_callees_result {
  const store = options.store;
  const edges = store.get_relationships_from(symbol_id);
  const callees: callee_hit[] = [];

  for (const edge of edges) {
    if (edge.kind !== 'calls') {
      continue;
    }
    callees.push({
      callee: edge.to_id === undefined ? undefined : store.get_symbol(edge.to_id),
      callee_name: edge.to_name,
      file_path: edge.file_path,
      line: edge.line,
      confidence: edge.confidence,
    });
  }

  callees.sort(by_location);
  return { callees };
}

/** Symbol ids embed the file path, then `#`, then the symbol description. */
function is_symbol_id(id: string): boolean {
  return id.indexOf('#') !== -1;
}

function by_location(
  left: { file_path: string; line: number },
  right: { file_path: string; line: number },
): number {
  const by_path = left.file_path.localeCompare(right.file_path);
  return by_path !== 0 ? by_path : left.line - right.line;
}
