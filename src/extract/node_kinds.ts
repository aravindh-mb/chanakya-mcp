/**
 * Mapping from tree-sitter node types to `symbol_kind`.
 *
 * The node type names here were read off the grammars rather than assumed, so
 * both the JavaScript and TypeScript spellings of the same concept are covered
 * (`field_definition` vs `public_field_definition`, and so on).
 */

import type { symbol_kind } from '../model/symbol.js';

/**
 * Declaration node types that always map to a single kind.
 *
 * `variable_declarator` is deliberately absent: its kind depends on the
 * declaring keyword and on whether the initializer is a function, so it is
 * resolved in the extractor instead.
 */
export const SYMBOL_KIND_BY_NODE_TYPE: Readonly<Record<string, symbol_kind>> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  /** `declare function f(): void` — no body. */
  function_signature: 'function',

  class_declaration: 'class',
  abstract_class_declaration: 'class',

  method_definition: 'method',
  /** `run(): void` inside an interface. */
  method_signature: 'method',
  abstract_method_signature: 'method',

  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',

  /** `namespace ns {}` */
  internal_module: 'module',
  /** `declare module 'name' {}` */
  module: 'module',
};

/** Node types that introduce a symbol, including the ones needing extra logic. */
export function is_declaration_node(node_type: string): boolean {
  return node_type in SYMBOL_KIND_BY_NODE_TYPE || node_type === 'variable_declarator';
}

/** Wrapper nodes that carry export or ambient context down to a declaration. */
export const EXPORT_STATEMENT = 'export_statement';
export const AMBIENT_DECLARATION = 'ambient_declaration';

/**
 * Node types that introduce a function body.
 *
 * Used to suppress indexing of local data variables. Callbacks are included
 * even though they are not symbols themselves, because their bodies are still
 * function-local scope.
 */
const FUNCTION_LIKE_TYPES: ReadonlySet<string> = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'generator_function',
  'arrow_function',
  'method_definition',
  'function_signature',
]);

export function is_function_like(node_type: string): boolean {
  return FUNCTION_LIKE_TYPES.has(node_type);
}

/** Initializer node types that make a `const` binding a function in practice. */
const FUNCTION_VALUE_TYPES: ReadonlySet<string> = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
]);

export function is_function_value(node_type: string): boolean {
  return FUNCTION_VALUE_TYPES.has(node_type);
}

/**
 * Kind for an anonymous `export default` value.
 *
 * `export default function () {}` parses as `function_expression`, and
 * `export default class {}` as `class` — different node types from their named
 * counterparts. Returns `undefined` for anything else, so `export default foo`
 * (a reference to an existing symbol) does not create a bogus declaration.
 *
 * This is applied only to an export statement's direct value, never to nested
 * expressions; otherwise every inline callback would become a symbol.
 */
export function anonymous_default_kind(node_type: string): symbol_kind | undefined {
  if (node_type === 'class' || node_type === 'class_expression') {
    return 'class';
  }
  return is_function_value(node_type) ? 'function' : undefined;
}
