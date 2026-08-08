/**
 * Lexical name resolution within one file.
 *
 * This answers the question "which symbol does this written name mean?" for
 * references and call targets. It is scope-aware, because a name is not a
 * fact: the same text can bind to a top-level constant, a sibling method, or a
 * nested function depending on where it appears.
 *
 * Resolution is deliberately conservative. A name is bound to a symbol only
 * when the lexical scope chain selects exactly one candidate. Overloads,
 * shadowing ambiguity, dynamic dispatch and property access on values whose
 * type is unknown all stay unresolved rather than guessed — the package never
 * invents a relationship.
 */

import type { syntax_node } from '../parser/types.js';
import type { code_symbol, symbol_kind } from '../model/symbol.js';

/**
 * A per-file index over the symbols `extract_symbols` produced.
 *
 * Precomputed once so that resolution during the reference/call walks is a
 * handful of map lookups instead of a scan of every symbol per mention.
 */
export interface scope_index {
  readonly by_id: ReadonlyMap<string, code_symbol>;
  /** parent_id -> symbols declared directly under it. */
  readonly children: ReadonlyMap<string, readonly code_symbol[]>;
  /** Symbols with no parent: the file's top-level names. */
  readonly top_level: readonly code_symbol[];
}

export function build_scope_index(symbols: readonly code_symbol[]): scope_index {
  const by_id = new Map<string, code_symbol>();
  const children = new Map<string, code_symbol[]>();
  const top_level: code_symbol[] = [];

  for (const symbol of symbols) {
    by_id.set(symbol.id, symbol);
    if (symbol.parent_id === undefined) {
      top_level.push(symbol);
    } else {
      const bucket = children.get(symbol.parent_id);
      if (bucket === undefined) {
        children.set(symbol.parent_id, [symbol]);
      } else {
        bucket.push(symbol);
      }
    }
  }

  return { by_id, children, top_level };
}

/**
 * Map from a declaration's start position to its symbol.
 *
 * The reference and call walks match tree nodes to symbols by position, since
 * a declaration node and its symbol share an exact range and no other node does.
 */
export function build_start_index(symbols: readonly code_symbol[]): ReadonlyMap<string, code_symbol> {
  const by_start = new Map<string, code_symbol>();
  for (const symbol of symbols) {
    by_start.set(start_key(symbol.start_line, symbol.start_column), symbol);
  }
  return by_start;
}

/**
 * The symbol whose declaration starts exactly at `line:column`, if any.
 *
 * Symbols share the start position of their declaration node, so a definition
 * reference can be bound to its symbol by the parent declaration's position —
 * no name resolution and no shadowing ambiguity.
 */
export function symbol_at(
  symbols_by_start: ReadonlyMap<string, code_symbol>,
  line: number,
  column: number,
): code_symbol | undefined {
  return symbols_by_start.get(start_key(line, column));
}

/** Symbol kinds whose members are reachable as bare names inside them. */
const BARE_SCOPE_KINDS: ReadonlySet<symbol_kind> = new Set(['function', 'method', 'module']);

/** Symbol kinds whose members are reached through `.` access. */
const CONTAINER_KINDS: ReadonlySet<symbol_kind> = new Set(['class', 'interface', 'enum', 'module']);

const FUNCTION_LIKE_KINDS: ReadonlySet<symbol_kind> = new Set(['function', 'method']);

/** The scope chain from `enclosing_id` outward, ending with the file itself. */
function scope_chain(scope: scope_index, enclosing_id: string | undefined): Array<code_symbol | undefined> {
  const chain: Array<code_symbol | undefined> = [];
  let current = enclosing_id === undefined ? undefined : scope.by_id.get(enclosing_id);

  while (current !== undefined) {
    chain.push(current);
    current = current.parent_id === undefined ? undefined : scope.by_id.get(current.parent_id);
  }

  chain.push(undefined);
  return chain;
}

/**
 * Resolve a bare identifier used inside `enclosing_id`.
 *
 * Walks the scope chain innermost-out. Function and method bodies make their
 * nested declarations visible; class members are deliberately not, because in
 * JavaScript a sibling method is not in lexical scope — `m()` inside another
 * method does not mean `this.m()`. A function's own name is bound inside its
 * body, which is how recursion resolves.
 */
export function resolve_name(
  scope: scope_index,
  name: string,
  enclosing_id: string | undefined,
): code_symbol | undefined {
  for (const level of scope_chain(scope, enclosing_id)) {
    if (level === undefined) {
      return unique_match(scope.top_level, name);
    }

    if (BARE_SCOPE_KINDS.has(level.kind)) {
      const matches = (scope.children.get(level.id) ?? []).filter((symbol) => symbol.name === name);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        return undefined;
      }
    }

    if (FUNCTION_LIKE_KINDS.has(level.kind) && level.name === name) {
      return level;
    }
  }

  return undefined;
}

/**
 * Resolve the symbol a declaration binds, in the scope that contains it.
 *
 * Used for definition references. Unlike `resolve_name` this includes class
 * and interface members, because a method name is a declaration inside the
 * class even though it is not in lexical scope for bare uses.
 */
export function resolve_declaration(
  scope: scope_index,
  name: string,
  enclosing_id: string | undefined,
): code_symbol | undefined {
  for (const level of scope_chain(scope, enclosing_id)) {
    const declared_under = level === undefined ? scope.top_level : (scope.children.get(level.id) ?? []);
    const found = unique_match(declared_under, name);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Resolve a member chain such as `user_service.create_user` or `this.m()`.
 *
 * The first segment is resolved as a bare name, or `this` is unwrapped to the
 * enclosing class. Each following segment must be a member of the previous
 * target. Unknown object types, `super`, computed access and anything else the
 * static model cannot see stay unresolved.
 */
export function resolve_member_chain(
  scope: scope_index,
  chain: readonly string[],
  enclosing_id: string | undefined,
): code_symbol | undefined {
  if (chain.length === 0) {
    return undefined;
  }

  let target: code_symbol | undefined;
  const first = chain[0] as string;

  if (first === 'this') {
    const enclosing = enclosing_id === undefined ? undefined : scope.by_id.get(enclosing_id);
    const parent = enclosing?.parent_id === undefined ? undefined : scope.by_id.get(enclosing.parent_id);
    if (parent === undefined || !CONTAINER_KINDS.has(parent.kind)) {
      return undefined;
    }
    target = parent;
  } else if (first === 'super') {
    // The superclass is only known through the extends relationship, which the
    // index does not resolve in this phase. Guessing is not an option.
    return undefined;
  } else {
    target = resolve_name(scope, first, enclosing_id);
  }

  if (target === undefined) {
    return undefined;
  }

  for (const segment of chain.slice(1)) {
    if (!CONTAINER_KINDS.has(target.kind)) {
      return undefined;
    }
    const found = unique_match(scope.children.get(target.id) ?? [], segment);
    if (found === undefined) {
      return undefined;
    }
    target = found;
  }

  return target;
}

/**
 * Read the identifier chain out of a callee or member expression.
 *
 * Returns the dotted segments for a plain identifier (`['f']`) or a member
 * chain (`['user_service', 'create_user']`), `['this', 'x']` for `this.x`,
 * and `undefined` for anything the resolver cannot reason about — a computed
 * access, a call inside a chain, dynamic `import(...)`.
 */
export function read_chain(node: syntax_node): readonly string[] | undefined {
  switch (node.type) {
    case 'identifier':
    case 'type_identifier':
      return [node.text];
    case 'this':
      return ['this'];
    case 'import':
      return undefined;
    case 'member_expression': {
      const object_chain = read_chain(node.child_by_field('object') ?? node.named_children[0]!);
      const property = node.child_by_field('property');
      if (
        object_chain === undefined ||
        property === undefined ||
        (property.type !== 'property_identifier' && property.type !== 'identifier')
      ) {
        return undefined;
      }
      return [...object_chain, property.text];
    }
    default:
      return undefined;
  }
}

/**
 * The lone symbol named `name`, or `undefined` when there is no match or the
 * name is ambiguous. An ambiguous name is a genuine fact of the code, not an
 * error: an agent must not be pointed at one overload on a guess.
 */
function unique_match(symbols: readonly code_symbol[], name: string): code_symbol | undefined {
  let found: code_symbol | undefined;
  for (const symbol of symbols) {
    if (symbol.name === name) {
      if (found !== undefined) {
        return undefined;
      }
      found = symbol;
    }
  }
  return found;
}

function start_key(line: number, column: number): string {
  return `${line}:${column}`;
}

/**
 * Walks a tree maintaining the stack of symbols that enclose the current node.
 *
 * Positions do the bookkeeping, so the tracker needs no tree knowledge: a
 * symbol is pushed when a node begins at the symbol's start position and popped
 * once the walk passes its end.
 */
export class scope_tracker {
  readonly #stack: code_symbol[] = [];
  readonly #by_start: ReadonlyMap<string, code_symbol>;

  constructor(by_start: ReadonlyMap<string, code_symbol>) {
    this.#by_start = by_start;
  }

  /**
   * Advance to `node`, returning the scope state for the reference at it:
   * `enclosing_id`, the innermost symbol containing the node.
   */
  advance(node: syntax_node): { readonly enclosing_id: string | undefined } {
    while (this.#stack.length > 0 && symbol_ended(this.#stack[this.#stack.length - 1]!, node)) {
      this.#stack.pop();
    }

    const starting = this.#by_start.get(start_key(node.range.start.line, node.range.start.column));
    if (starting !== undefined) {
      this.#stack.push(starting);
    }

    return { enclosing_id: this.#stack.length > 0 ? this.#stack[this.#stack.length - 1]!.id : undefined };
  }
}

/** Whether `node` starts at or after the symbol's end. */
function symbol_ended(symbol: code_symbol, node: syntax_node): boolean {
  return (
    symbol.end_line < node.range.start.line ||
    (symbol.end_line === node.range.start.line && symbol.end_column <= node.range.start.column)
  );
}
