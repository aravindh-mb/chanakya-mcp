/**
 * Search inputs and results.
 *
 * Results carry locations and signatures, never file contents. The point of
 * this package is to let an agent find the three lines it needs instead of
 * reading three files, so a search result that embedded source would defeat it.
 */

import type { code_symbol, symbol_kind } from '../model/symbol.js';
import type { language_id } from '../scanner/language.js';

/** How a query string is compared against a symbol name. */
export type match_mode = 'exact' | 'prefix' | 'substring';

export const DEFAULT_SYMBOL_LIMIT = 50;
export const DEFAULT_CODE_LIMIT = 50;
export const DEFAULT_MATCHES_PER_FILE = 5;

export interface search_symbols_options {
  /** Name to look for. */
  readonly query: string;
  /**
   * Narrowest comparison to accept. `substring` (the default) also returns
   * exact and prefix matches, ranked above it.
   */
  readonly match?: match_mode;
  /** Default `false`: `userservice` finds `UserService`. */
  readonly case_sensitive?: boolean;
  readonly kinds?: readonly symbol_kind[];
  readonly languages?: readonly language_id[];
  /** Substring match against the POSIX relative path, e.g. `apps/api`. */
  readonly path_contains?: string;
  /** Only symbols the file exports. */
  readonly exported_only?: boolean;
  /** Exclude `.d.ts` and `declare` symbols, which are rarely the edit target. */
  readonly exclude_ambient?: boolean;
  readonly limit?: number;
}

export interface symbol_hit {
  readonly symbol: code_symbol;
  /** How this symbol matched, which is also the primary ranking key. */
  readonly match: match_mode;
}

export interface search_symbols_result {
  readonly hits: readonly symbol_hit[];
  /** True when the limit cut the results short. */
  readonly truncated: boolean;
}

export interface search_code_options {
  /** Literal text, or a regular expression when `is_regex` is set. */
  readonly query: string;
  readonly is_regex?: boolean;
  readonly case_sensitive?: boolean;
  readonly languages?: readonly language_id[];
  /** Substring match against the POSIX relative path. */
  readonly path_contains?: string;
  /** Total matches to return. */
  readonly limit?: number;
  /** Cap per file, so one generated file cannot fill the whole result. */
  readonly max_matches_per_file?: number;
  /** Lines of surrounding source to include. Default 0. */
  readonly context_lines?: number;
  /** Give up after this long. Guards against a pathological pattern. */
  readonly time_budget_ms?: number;
}

/** The symbol whose body encloses a match, when there is one. */
export interface enclosing_symbol {
  readonly id: string;
  readonly name: string;
  readonly kind: symbol_kind;
}

export interface code_match {
  readonly file_path: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based, of the first character of the match. */
  readonly column: number;
  /** The matching line, trimmed of indentation and truncated if very long. */
  readonly text: string;
  readonly context_before?: readonly string[];
  readonly context_after?: readonly string[];
  /**
   * Which symbol the match sits inside. This is the part a plain grep cannot
   * provide, and it is often enough for an agent to skip opening the file.
   */
  readonly enclosing?: enclosing_symbol;
}

export interface search_code_result {
  readonly matches: readonly code_match[];
  readonly files_searched: number;
  readonly truncated: boolean;
  /** True when the time budget stopped the search early. */
  readonly timed_out: boolean;
}
