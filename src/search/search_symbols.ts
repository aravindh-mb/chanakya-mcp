/**
 * Symbol name search.
 *
 * Runs up to three queries in precedence order — exact, then prefix, then
 * substring — rather than one combined query, for two reasons. `name = ?` and
 * `name LIKE 'q%'` can use the name index while `LIKE '%q%'` cannot, so the
 * cheap comparisons run first; and issuing them separately is what makes the
 * ranking exact-before-prefix-before-substring without sorting the whole table.
 *
 * Searching stops as soon as the limit is filled, so an exact hit never pays
 * for a full scan.
 */

import type { code_symbol } from '../model/symbol.js';
import type { index_store, sql_condition } from '../store/index_store.js';
import { escape_like } from './pattern.js';
import {
  DEFAULT_SYMBOL_LIMIT,
  type match_mode,
  type search_symbols_options,
  type search_symbols_result,
  type symbol_hit,
} from './types.js';

/** Ordered from narrowest to widest; a mode also implies the ones before it. */
const MATCH_PRECEDENCE: readonly match_mode[] = ['exact', 'prefix', 'substring'];

export function search_symbols(store: index_store, options: search_symbols_options): search_symbols_result {
  const limit = Math.max(0, options.limit ?? DEFAULT_SYMBOL_LIMIT);
  const widest = options.match ?? 'substring';
  const modes = MATCH_PRECEDENCE.slice(0, MATCH_PRECEDENCE.indexOf(widest) + 1);

  const hits: symbol_hit[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const mode of modes) {
    if (hits.length >= limit) {
      truncated = true;
      break;
    }

    // Over-fetch by the number already found, since earlier modes' results
    // reappear in later, wider ones and are filtered out below.
    const candidates = store.query_symbols({
      name_condition: build_name_condition(mode, options.query, options.case_sensitive === true),
      ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
      ...(options.languages === undefined ? {} : { languages: options.languages }),
      ...(options.path_contains === undefined
        ? {}
        : { path_like: `%${escape_like(options.path_contains)}%` }),
      ...(options.exported_only === undefined ? {} : { exported_only: options.exported_only }),
      ...(options.exclude_ambient === undefined ? {} : { exclude_ambient: options.exclude_ambient }),
      limit: limit + hits.length + 1,
    });

    for (const symbol of candidates) {
      if (seen.has(symbol.id)) {
        continue;
      }
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      seen.add(symbol.id);
      hits.push({ symbol, match: mode });
    }
  }

  return { hits: rank(hits), truncated };
}

/**
 * Build the name comparison for one mode.
 *
 * Case-insensitive comparisons use `LIKE`, which SQLite treats as
 * case-insensitive for ASCII. Case-sensitive ones deliberately avoid `LIKE` and
 * `GLOB`: `LIKE` cannot be made case-sensitive without changing a database-wide
 * pragma, and `GLOB` has no escape clause, so a query containing `*` or `[`
 * would silently become a wildcard. `substr` and `instr` have neither problem.
 */
function build_name_condition(mode: match_mode, query: string, case_sensitive: boolean): sql_condition {
  if (case_sensitive) {
    switch (mode) {
      case 'exact':
        return { sql: 'name = ?', parameters: [query] };
      case 'prefix':
        return { sql: 'substr(name, 1, ?) = ?', parameters: [String(query.length), query] };
      case 'substring':
        return { sql: 'instr(name, ?) > 0', parameters: [query] };
    }
  }

  const escaped = escape_like(query);
  switch (mode) {
    case 'exact':
      return { sql: 'name = ? COLLATE NOCASE', parameters: [query] };
    case 'prefix':
      return { sql: `name LIKE ? ESCAPE '\\'`, parameters: [`${escaped}%`] };
    case 'substring':
      return { sql: `name LIKE ? ESCAPE '\\'`, parameters: [`%${escaped}%`] };
  }
}

/**
 * Order results the way someone reading them expects.
 *
 * Match quality dominates; a shorter name is a closer fit for the same match
 * kind; an exported symbol is more likely to be what an outside caller meant;
 * and path plus line make the order stable across runs.
 */
function rank(hits: readonly symbol_hit[]): symbol_hit[] {
  return [...hits].sort((left, right) => {
    const by_match = MATCH_PRECEDENCE.indexOf(left.match) - MATCH_PRECEDENCE.indexOf(right.match);
    if (by_match !== 0) {
      return by_match;
    }

    const by_length = left.symbol.name.length - right.symbol.name.length;
    if (by_length !== 0) {
      return by_length;
    }

    const by_export = export_rank(left.symbol) - export_rank(right.symbol);
    if (by_export !== 0) {
      return by_export;
    }

    const by_path = left.symbol.file_path.localeCompare(right.symbol.file_path);
    return by_path !== 0 ? by_path : left.symbol.start_line - right.symbol.start_line;
  });
}

function export_rank(symbol: code_symbol): number {
  return symbol.export_kind === 'none' ? 1 : 0;
}
