/**
 * Result shapes for code navigation.
 *
 * Navigation answers "where is this", "who points at this" and "who calls
 * this" with locations and symbol details — never file contents. That is the
 * same rule as search: the index stores locations, names and signatures, not
 * source.
 */

import type { code_symbol } from '../model/symbol.js';
import type { relationship_confidence } from '../model/relationship.js';

export interface find_definition_result {
  /** The symbol, or undefined when no such id is indexed. */
  readonly symbol: code_symbol | undefined;
}

export interface reference_hit {
  readonly file_path: string;
  readonly line: number;
  readonly column: number;
  readonly is_definition: boolean;
  /** The symbol whose body contains this occurrence, when there is one. */
  readonly enclosing_symbol?: code_symbol | undefined;
}

export interface find_references_result {
  /**
   * Every indexed occurrence of the symbol, definition first, ordered by
   * location. Same-file mentions were resolved during extraction; mentions in
   * other files were resolved by the graph pass when the name arrived through
   * a named or default import.
   */
  readonly references: readonly reference_hit[];
}

export interface caller_hit {
  /** The symbol whose body contains the call, or undefined for a top-level call. */
  readonly caller: code_symbol | undefined;
  readonly file_path: string;
  readonly line: number;
  readonly confidence: relationship_confidence;
}

export interface find_callers_result {
  readonly callers: readonly caller_hit[];
}

export interface callee_hit {
  /** The called symbol, or undefined when the edge is unresolved. */
  readonly callee: code_symbol | undefined;
  /** Exactly as written in the source, e.g. `user_service.create_user`. */
  readonly callee_name: string;
  readonly file_path: string;
  readonly line: number;
  readonly confidence: relationship_confidence;
}

export interface find_callees_result {
  readonly callees: readonly callee_hit[];
}
