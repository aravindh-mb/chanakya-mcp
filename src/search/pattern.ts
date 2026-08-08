/**
 * Turning a user query into a matcher, safely.
 *
 * User-supplied regular expressions are the one place this package accepts
 * something that can hang it, so the defences are worth stating precisely.
 *
 * The only defence that actually addresses catastrophic backtracking is
 * `assert_regex_is_safe`, which rejects nested unbounded quantifiers before the
 * pattern ever runs. The measurement behind that lives in `regex_safety.ts`:
 * `(a+)+$` needs 15 seconds against a **30 character** line, so neither a line
 * length cap nor a wall-clock budget between lines can save anything — the
 * engine never yields during a single failing match.
 *
 * The other limits here are real but solve different problems:
 *
 * - The pattern length cap bounds how much work compiling can do.
 * - The line length cap skips minified and generated lines. Those are not what
 *   anyone is searching for, and matching them wastes time. It is **not** ReDoS
 *   protection, and was mistaken for it once already.
 */

import { code_intelligence_error } from '../core/errors.js';
import { assert_regex_is_safe } from './regex_safety.js';

export const MAX_PATTERN_LENGTH = 1_000;

/**
 * Lines longer than this are skipped: they are bundles or generated blobs, not
 * something a person is searching for. This is a relevance and throughput
 * limit, not a safety one.
 */
export const MAX_LINE_LENGTH = 2_000;

export interface line_matcher {
  /**
   * Index of the first match in `line`, or -1. Returns a 0-based offset.
   */
  find(line: string): number;
}

export interface build_matcher_options {
  readonly query: string;
  readonly is_regex?: boolean;
  readonly case_sensitive?: boolean;
}

export function build_line_matcher(options: build_matcher_options): line_matcher {
  const { query } = options;

  if (query.length === 0) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: 'The search query is empty.',
      hint: 'Pass the text or pattern to search for.',
    });
  }

  if (query.length > MAX_PATTERN_LENGTH) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `The search query is ${query.length} characters, over the ${MAX_PATTERN_LENGTH} character limit.`,
      hint: 'Shorten the query.',
    });
  }

  return options.is_regex === true ? build_regex_matcher(options) : build_literal_matcher(options);
}

function build_literal_matcher(options: build_matcher_options): line_matcher {
  const needle = options.case_sensitive === true ? options.query : options.query.toLowerCase();

  return {
    find(line: string): number {
      if (line.length > MAX_LINE_LENGTH) {
        return -1;
      }
      const haystack = options.case_sensitive === true ? line : line.toLowerCase();
      return haystack.indexOf(needle);
    },
  };
}

function build_regex_matcher(options: build_matcher_options): line_matcher {
  // Checked before compiling: an exponential pattern cannot be interrupted once
  // it starts, so refusing it up front is the only workable point.
  assert_regex_is_safe(options.query);

  const flags = options.case_sensitive === true ? '' : 'i';

  let expression: RegExp;
  try {
    expression = new RegExp(options.query, flags);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `The search pattern is not a valid regular expression: ${options.query}`,
      hint: 'Escape special characters, or search without is_regex for a literal match.',
      cause,
    });
  }

  return {
    find(line: string): number {
      // Long lines are the amplifier for catastrophic backtracking, and are
      // generated output rather than anything worth finding.
      if (line.length > MAX_LINE_LENGTH) {
        return -1;
      }
      // No `g` flag, so there is no `lastIndex` to reset between calls — a
      // stateful regex reused across lines silently skips matches.
      return line.search(expression);
    },
  };
}

/**
 * Escape a value for use inside a SQL `LIKE` pattern.
 *
 * Without this, a query containing `%` or `_` becomes a wildcard and quietly
 * matches far more than the user asked for.
 */
export function escape_like(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
