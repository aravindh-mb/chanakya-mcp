/**
 * Deriving a one-line signature from a declaration.
 *
 * The signature is the declaration with its body removed — the part a reader
 * needs to call or implement something. This is what makes Phase 14 possible:
 * an agent asking about `create_user` gets the signature instead of the whole
 * function body.
 */

import type { syntax_node } from '../parser/types.js';
import { is_function_value } from './node_kinds.js';

/** Signatures longer than this are truncated; they are meant to be scannable. */
export const MAX_SIGNATURE_LENGTH = 200;

const TRUNCATION_SUFFIX = '...';

/**
 * Build the signature for `node`.
 *
 * `start_index` allows a caller to include leading context the node itself
 * excludes — notably `const` / `let` for a variable declarator, which lives on
 * the parent declaration node.
 */
export function build_signature(
  node: syntax_node,
  source: string,
  start_index: number = node.range.start_index,
): string | undefined {
  const body = find_body(node);
  const end_index = body === undefined ? node.range.end_index : body.range.start_index;

  if (end_index <= start_index) {
    return undefined;
  }

  const raw = source.slice(start_index, end_index);
  const collapsed = collapse_whitespace(raw);
  const trimmed = trim_trailing_punctuation(collapsed);

  return trimmed.length === 0 ? undefined : truncate(trimmed);
}

/**
 * The node whose start marks the end of the signature.
 *
 * A function's `body` field is the obvious case. Arrow functions assigned to a
 * variable keep their body on the initializer, so the initializer is followed
 * one level down.
 *
 * The initializer is only followed when it is a function. Several declarations
 * have a `value` field that *is* the meaningful part rather than a body —
 * `type user_id = string` is the clearest — and cutting there would throw away
 * exactly what the reader needs.
 */
function find_body(node: syntax_node): syntax_node | undefined {
  const own_body = node.child_by_field('body');
  if (own_body !== undefined) {
    return own_body;
  }

  const value = node.child_by_field('value');
  if (value !== undefined && is_function_value(value.type)) {
    return value.child_by_field('body') ?? value;
  }

  return undefined;
}

function collapse_whitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Drop the punctuation that separates a declaration from its body. */
function trim_trailing_punctuation(value: string): string {
  return value.replace(/[\s{=;,:]+$/, '').trim();
}

function truncate(value: string): string {
  if (value.length <= MAX_SIGNATURE_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_SIGNATURE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}
