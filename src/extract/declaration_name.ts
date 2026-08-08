/**
 * Reading a declaration's name out of a syntax node.
 *
 * Names are messier than they look: method keys can be computed
 * (`[Symbol.iterator]`), string literals (`"str-key"`) or private (`#priv`);
 * ambient modules are named by a string literal; and default exports may have
 * no name at all.
 */

import type { syntax_node } from '../parser/types.js';

/** Name used for `export default function () {}` and friends. */
export const DEFAULT_EXPORT_NAME = 'default';

/**
 * The declared name, or `undefined` when the node binds no single name.
 *
 * Returning `undefined` is meaningful: destructuring patterns genuinely bind
 * several names, and anonymous declarations bind none, so the caller decides
 * what to do rather than receiving an invented name.
 */
export function read_declaration_name(node: syntax_node): string | undefined {
  const name_node = node.child_by_field('name');
  if (name_node === undefined) {
    return undefined;
  }
  return normalize_name_node(name_node);
}

function normalize_name_node(name_node: syntax_node): string | undefined {
  switch (name_node.type) {
    case 'identifier':
    case 'type_identifier':
    case 'property_identifier':
    case 'private_property_identifier':
    case 'shorthand_property_identifier':
      return name_node.text;

    // `declare module 'name' {}` and `"str-key"() {}` are named by a literal.
    case 'string':
      return strip_quotes(name_node.text);

    // `[Symbol.iterator]() {}` — keep the source form, which is what a reader
    // would search for. Inventing a plain name here would be a guess.
    case 'computed_property_name':
      return name_node.text;

    // Destructuring binds many names, not one. The caller handles this.
    case 'object_pattern':
    case 'array_pattern':
      return undefined;

    default:
      return name_node.text.length === 0 ? undefined : name_node.text;
  }
}

function strip_quotes(value: string): string {
  const first = value.charAt(0);
  const is_quoted =
    value.length >= 2 && (first === '"' || first === "'" || first === '`') && value.endsWith(first);
  return is_quoted ? value.slice(1, -1) : value;
}

/** True when a variable declarator binds a destructuring pattern. */
export function is_pattern_binding(node: syntax_node): boolean {
  const name_node = node.child_by_field('name');
  return (
    name_node !== undefined && (name_node.type === 'object_pattern' || name_node.type === 'array_pattern')
  );
}
