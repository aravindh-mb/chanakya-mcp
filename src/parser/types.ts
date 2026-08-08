/**
 * The parser layer's public shapes.
 *
 * Nothing in this file references tree-sitter. Everything above the parser
 * consumes these types only, so the grammar backend (native today, WASM if
 * ever needed) can be swapped without touching the rest of the package.
 */

import type { language_id } from '../scanner/language.js';

/**
 * A position in a source file.
 *
 * **1-based line and column**, matching what editors display. tree-sitter is
 * 0-based; the conversion happens once, in the node adapter, so that every
 * layer above this one shares a single convention.
 */
export interface source_position {
  readonly line: number;
  readonly column: number;
}

export interface source_range {
  readonly start: source_position;
  readonly end: source_position;
  /**
   * Offsets into the source string, 0-based and half-open.
   * These are JavaScript string indices (UTF-16 code units), **not** byte
   * offsets, so `source.slice(start_index, end_index)` is always exact — this
   * was verified against non-ASCII sources rather than assumed.
   */
  readonly start_index: number;
  readonly end_index: number;
}

/**
 * A node in the concrete syntax tree, normalized away from tree-sitter.
 *
 * Children are wrapped lazily: walking a small part of a large file does not
 * materialize the whole tree.
 */
export interface syntax_node {
  /** Grammar node type, e.g. `function_declaration`, `class_body`. */
  readonly type: string;
  /** Named nodes are meaningful; unnamed ones are punctuation and keywords. */
  readonly is_named: boolean;
  /** True when the parser inserted this node to recover from a syntax error. */
  readonly is_missing: boolean;
  /** True when this node or anything beneath it failed to parse. */
  readonly has_error: boolean;
  readonly range: source_range;
  /** Exact source text of this node. */
  readonly text: string;
  readonly children: readonly syntax_node[];
  readonly named_children: readonly syntax_node[];
  readonly parent: syntax_node | undefined;
  /** Child in a named grammar field, e.g. `name` or `body`. */
  child_by_field(field_name: string): syntax_node | undefined;
  /** Depth-first pre-order traversal, including this node. */
  walk(): IterableIterator<syntax_node>;
}

export type parse_error_kind = 'error' | 'missing';

export interface parse_error {
  readonly kind: parse_error_kind;
  /** Human readable description, safe to show to a user or agent. */
  readonly message: string;
  readonly range: source_range;
}

/**
 * The result of parsing one file.
 *
 * Parsing is error-tolerant: a file with syntax errors still yields a usable
 * tree plus a populated `parse_errors`. `parse_source` does not throw on bad
 * syntax, because refusing to index a file with one typo would be worse than
 * indexing the parts that did parse.
 */
export interface parsed_file {
  /** Absolute native path, or a synthetic label when parsing a string. */
  readonly file_path: string;
  readonly language: language_id;
  readonly root: syntax_node;
  readonly parse_errors: readonly parse_error[];
  /**
   * The exact source that was parsed. Retained because every range refers to
   * it, and later phases slice it for signatures and snippets. It is per-file
   * and transient: nothing holds many `parsed_file`s at once.
   */
  readonly source: string;
  readonly has_errors: boolean;
}

export interface parse_source_options {
  readonly source: string;
  /** Used for error messages and for language detection when `language` is omitted. */
  readonly file_path: string;
  /** Overrides extension-based detection. */
  readonly language?: language_id;
  /** Cap on collected errors, so a pathological file cannot exhaust memory. Default 100. */
  readonly max_parse_errors?: number;
}

export interface parse_file_options {
  /** Absolute native path to read. */
  readonly file_path: string;
  readonly language?: language_id;
  /** Files larger than this are rejected rather than parsed. Default 1 MiB. */
  readonly max_source_bytes?: number;
  readonly max_parse_errors?: number;
}

export const DEFAULT_MAX_PARSE_ERRORS = 100;
export const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024;
