/**
 * Reading string literals used as module specifiers.
 *
 * tree-sitter represents `"./m"` and `'./m'` as a `string` node whose text
 * includes the quotes, plus a `string_fragment` child without them. The two
 * callers that need this (imports and exports) share it.
 */

/** Strip the surrounding quotes from a tree-sitter `string` node's text. */
export function unquote(value: string): string {
  const first = value.charAt(0);
  const is_quoted =
    value.length >= 2 && (first === '"' || first === "'" || first === '`') && value.endsWith(first);
  return is_quoted ? value.slice(1, -1) : value;
}
