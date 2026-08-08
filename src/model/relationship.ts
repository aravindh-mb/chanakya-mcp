/**
 * Relationships between symbols, and the confidence rules that govern them.
 *
 * The governing rule for this whole package: **never invent a relationship**.
 * Static analysis of JavaScript and TypeScript cannot resolve dynamic dispatch,
 * `eval`, computed member access, or values that flow through a dependency
 * injection container. When the target of an edge cannot be resolved, the edge
 * is recorded as unresolved (naming what was written in the source) or not
 * recorded at all — it is never pointed at a plausible-looking symbol.
 *
 * An agent acting on a fabricated "calls" edge will edit the wrong function, so
 * a missing edge is far cheaper than a wrong one.
 */

export type relationship_kind =
  /** Lexical containment: a class contains its methods. Always certain. */
  | 'contains'
  /** A file imports from a module specifier. */
  | 'imports'
  /** A file exports a symbol. */
  | 'exports'
  /** A call expression whose callee resolved to a symbol. */
  | 'calls'
  /** A non-call mention of a symbol. */
  | 'references'
  /** `class a extends b` / `interface a extends b`. */
  | 'extends'
  /** `class a implements b`. */
  | 'implements';

export const RELATIONSHIP_KINDS: readonly relationship_kind[] = [
  'contains',
  'imports',
  'exports',
  'calls',
  'references',
  'extends',
  'implements',
];

/**
 * How much the indexer trusts an edge.
 *
 * - `certain`: derived from syntax alone, cannot be wrong. Containment, and
 *   edges whose target is declared in the same file with an unambiguous name.
 * - `resolved`: the target was resolved across files by following an import to
 *   a matching exported name. Correct unless the module resolution was wrong.
 *
 * There is no `guessed` level, by design. Anything weaker than `resolved` is
 * stored with `to_symbol_id` absent rather than pointed at a guess.
 */
export type relationship_confidence = 'certain' | 'resolved';

export const RELATIONSHIP_CONFIDENCES: readonly relationship_confidence[] = ['certain', 'resolved'];

/** Narrow an untrusted string, e.g. an MCP tool argument or a database row. */
export function is_relationship_kind(value: unknown): value is relationship_kind {
  return typeof value === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(value);
}

export interface relationship {
  /**
   * Opaque storage key. Assigned by the index on write and present on every
   * row read back; extractors leave it absent. Not part of the public surface.
   */
  readonly id?: string | undefined;
  readonly kind: relationship_kind;
  /** Id of the symbol the edge starts at, or a file id for file-level edges. */
  readonly from_id: string;
  /**
   * Id of the target symbol. Absent when the target could not be resolved —
   * which is a normal, expected outcome, not an error.
   */
  readonly to_id?: string | undefined;
  /**
   * What the source code actually wrote, e.g. `user_service.create_user` or a
   * module specifier. Always present, so an unresolved edge still carries
   * useful information for an agent and for later resolution passes.
   */
  readonly to_name: string;
  readonly confidence: relationship_confidence;
  /** POSIX path of the file the edge was observed in. */
  readonly file_path: string;
  /** 1-based line where the edge was observed. */
  readonly line: number;
}

/** True when an edge points at a known symbol rather than only a written name. */
export function is_resolved(edge: relationship): boolean {
  return edge.to_id !== undefined;
}
