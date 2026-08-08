/**
 * The normalized symbol model.
 *
 * This is the layer the MCP tools and the SQLite index speak. It is
 * deliberately *not* a unified AST: it does not try to represent every
 * construct in every language. It captures the handful of facts an agent
 * actually asks for — what is this called, what kind of thing is it, where does
 * it live, what contains it — and nothing more.
 *
 * Anything that cannot be determined reliably from syntax is left absent rather
 * than guessed. An absent field means "not known", never "does not exist".
 */

import type { language_id } from '../scanner/language.js';
import type { source_range } from '../parser/types.js';

/**
 * What kind of thing a symbol is.
 *
 * `variable` vs `constant` follows the declaration keyword (`const` gives
 * `constant`), not mutability analysis. `method` is a function declared inside
 * a class or object body; a plain nested function stays a `function`.
 */
export type symbol_kind =
  'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'constant' | 'enum' | 'module';

export const SYMBOL_KINDS: readonly symbol_kind[] = [
  'function',
  'class',
  'method',
  'interface',
  'type',
  'variable',
  'constant',
  'enum',
  'module',
];

/**
 * How a symbol leaves its file, when it does.
 *
 * `default` and `named` are exports; `none` means file-local. This is a
 * property of the declaration, so it lives on the symbol rather than only in
 * the exports table.
 */
export type export_kind = 'none' | 'named' | 'default';

/** Narrow an untrusted string, e.g. an MCP tool argument or a database row. */
export function is_symbol_kind(value: unknown): value is symbol_kind {
  return typeof value === 'string' && (SYMBOL_KINDS as readonly string[]).includes(value);
}

export interface code_symbol {
  /**
   * Stable identity, derived from the file path, the containment path and the
   * kind — not from line numbers, so a symbol keeps its id when code above it
   * moves. See `build_symbol_id`.
   */
  readonly id: string;
  readonly name: string;
  readonly kind: symbol_kind;
  /** POSIX path relative to the project root. */
  readonly file_path: string;
  readonly language: language_id;

  /** 1-based, inclusive. Spans the whole declaration. */
  readonly start_line: number;
  readonly end_line: number;
  /** 1-based. */
  readonly start_column: number;
  readonly end_column: number;

  /** Enclosing symbol, e.g. the class a method belongs to. */
  readonly parent_id?: string | undefined;

  /**
   * One-line declaration text with the body removed, e.g.
   * `async create_user(input: create_input): Promise<user>`.
   * Absent when a meaningful signature cannot be derived.
   */
  readonly signature?: string | undefined;

  readonly export_kind: export_kind;

  /** True for TypeScript `declare` / ambient declarations and `.d.ts` content. */
  readonly is_ambient: boolean;
}

/** Byte-free location pair used when reporting a symbol alongside its source. */
export interface symbol_location {
  readonly file_path: string;
  readonly range: source_range;
}

/**
 * Build a symbol's stable id.
 *
 * Format: `<file_path>#<kind>:<container path>`, where the container path joins
 * enclosing symbol names with `.`, e.g.
 * `src/user.ts#method:user_service.create_user`.
 *
 * Line numbers are deliberately excluded so that editing one function does not
 * change the ids of every symbol below it — that stability is what lets the
 * incremental indexer (Phase 7) diff a file instead of replacing it wholesale.
 *
 * Collisions are possible for genuinely ambiguous code (two overloads with the
 * same name in the same scope). `disambiguator` exists for that case and is
 * appended only when needed, so the common case stays readable.
 */
export function build_symbol_id(options: {
  readonly file_path: string;
  readonly kind: symbol_kind;
  readonly container_path: readonly string[];
  readonly disambiguator?: number | undefined;
}): string {
  const path = options.container_path.join('.');
  const base = `${options.file_path}#${options.kind}:${path}`;
  return options.disambiguator === undefined ? base : `${base}~${options.disambiguator}`;
}
