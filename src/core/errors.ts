/**
 * Error primitives shared by every layer of the package.
 *
 * Rules:
 * - never swallow an error silently
 * - always attach a machine readable `code`
 * - always attach a human readable `message` that says what to do next
 */

export type error_code =
  | 'invalid_usage'
  | 'invalid_project_root'
  | 'project_root_not_found'
  | 'project_root_not_directory'
  | 'unsupported_language'
  | 'parser_unavailable'
  | 'source_too_large'
  | 'file_not_readable'
  | 'index_unavailable'
  | 'watch_unavailable'
  | 'unsafe_pattern'
  | 'internal_error';

export interface error_options {
  readonly code: error_code;
  readonly message: string;
  /** Optional underlying cause, preserved for debugging. */
  readonly cause?: unknown;
  /** Optional short hint telling the user how to fix the problem. */
  readonly hint?: string;
}

/**
 * Base error type for the whole package.
 *
 * Named in snake_case to stay consistent with the rest of the codebase.
 */
export class code_intelligence_error extends Error {
  readonly code: error_code;
  readonly hint: string | undefined;

  constructor(options: error_options) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'code_intelligence_error';
    this.code = options.code;
    this.hint = options.hint;
  }
}

export function is_code_intelligence_error(value: unknown): value is code_intelligence_error {
  return value instanceof code_intelligence_error;
}

/**
 * Convert an unknown thrown value into a readable single line description.
 * Used at process boundaries where `catch (error: unknown)` gives us no type.
 */
export function describe_unknown_error(value: unknown): string {
  if (is_code_intelligence_error(value)) {
    return value.hint === undefined ? value.message : `${value.message} (${value.hint})`;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  return stringify_safely(value);
}

/**
 * `JSON.stringify` returns `undefined` (not a string) for `undefined`, functions
 * and symbols, and throws on circular structures. Both cases fall back to
 * `String()` so callers always receive a string.
 */
export function stringify_safely(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}
