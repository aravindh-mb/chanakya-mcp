/**
 * Turning a user query into a matcher, safely.
 *
 * User-supplied regular expressions are the one place this package accepts
 * something that can hang it, so the defences are worth stating precisely.
 *
 * Regex matching runs in a **worker thread** that the caller can terminate, so
 * a pattern that backtracks exponentially is killed by the time budget instead
 * of hanging the server. The engine never yields during a single failing match,
 * so nothing in the main thread can interrupt it; only terminating the thread
 * can. The worker receives lines in batches and answers with match columns, and
 * `dispose()` hard-stops any match still running.
 *
 * `assert_regex_is_safe` still runs first: it catches the nested-quantifier
 * family (`(a+)+`) before a worker is even spawned, which is faster and gives
 * a better error than a timeout. It is a fast path now, not the only defence —
 * the worker is the backstop for everything the heuristic misses.
 *
 * The other limits here solve different problems:
 *
 * - The pattern length cap bounds how much work compiling can do.
 * - The line length cap skips minified and generated lines. Those are not what
 *   anyone is searching for, and matching them wastes time. It is **not** ReDoS
 *   protection, and was mistaken for it once already.
 */

import { Worker } from 'node:worker_threads';
import { code_intelligence_error } from '../core/errors.js';
import { assert_regex_is_safe } from './regex_safety.js';

export const MAX_PATTERN_LENGTH = 1_000;

/**
 * Lines longer than this are skipped: they are bundles or generated blobs, not
 * something a person is searching for. This is a relevance and throughput
 * limit, not a safety one.
 */
export const MAX_LINE_LENGTH = 2_000;

/**
 * The worker thread that performs regex matching, as source.
 *
 * It is embedded rather than a file on disk so that both the bundled build
 * (`dist/`) and the tests (which run the TypeScript directly) resolve the same
 * code. A file URL would not survive bundling, and a `.ts` worker file would
 * not load under the test runner. `type: 'module'` with `eval` is the supported
 * way to run module code from a string in a worker.
 *
 * `MAX_LINE_LENGTH` is interpolated so the worker never needs imports.
 */
const REGEX_WORKER_SOURCE = `
import { parentPort } from 'node:worker_threads';

const port = parentPort;
if (port === null) {
  throw new Error('regex_worker must run as a worker thread');
}

port.on('message', (message) => {
  try {
    const expression = new RegExp(message.pattern, message.flags);
    const lines = message.lines;
    const columns = new Array(lines.length);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      columns[index] = line.length > ${MAX_LINE_LENGTH} ? -1 : line.search(expression);
    }
    port.postMessage({ id: message.id, columns });
  } catch (error) {
    port.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

export interface line_matcher {
  /**
   * First-match column (0-based, -1 for none) for each line.
   *
   * Matching may run in a worker thread; `dispose()` terminates anything still
   * in flight, so this promise may reject with a `search_timeout` error after
   * the budget ran out rather than resolving.
   */
  find_all(lines: readonly string[]): Promise<number[]>;
  /**
   * `false` only when no line of `source` can match, so the caller can skip the
   * file without splitting it. Always `true` for regexes: running a user regex
   * over a whole file on the main thread would bypass the worker's time budget.
   */
  may_match(source: string): boolean;
  /** Release the worker thread. Idempotent; no `find_all` calls after this. */
  dispose(): Promise<void>;
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
    async find_all(lines: readonly string[]): Promise<number[]> {
      const columns = new Array<number>(lines.length);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] as string;
        if (line.length > MAX_LINE_LENGTH) {
          columns[index] = -1;
          continue;
        }
        const haystack = options.case_sensitive === true ? line : line.toLowerCase();
        columns[index] = haystack.indexOf(needle);
      }
      return columns;
    },
    may_match(source: string): boolean {
      return (options.case_sensitive === true ? source : source.toLowerCase()).includes(needle);
    },
    dispose(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function build_regex_matcher(options: build_matcher_options): line_matcher {
  // Checked before compiling or spawning: the nested-quantifier family is
  // refused up front, so those patterns never pay for a worker at all.
  assert_regex_is_safe(options.query);

  const flags = options.case_sensitive === true ? '' : 'i';

  // Compiled here as well as in the worker, so an invalid pattern fails with a
  // precise message instead of a generic worker error.
  try {
    new RegExp(options.query, flags);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `The search pattern is not a valid regular expression: ${options.query}`,
      hint: 'Escape special characters, or search without is_regex for a literal match.',
      cause,
    });
  }

  const worker = spawn_regex_worker();
  let next_id = 0;
  let disposed = false;
  const pending = new Map<number, { resolve(columns: number[]): void; reject(error: unknown): void }>();

  const fail_pending = (error: unknown): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  worker.on('message', (message: { id: number; columns?: number[]; error?: string }) => {
    const entry = pending.get(message.id);
    if (entry === undefined) {
      // A response can arrive after the budget gave up on it; nothing to do.
      return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(
        new code_intelligence_error({
          code: 'invalid_usage',
          message: `The search pattern is not a valid regular expression: ${message.error}`,
          hint: 'Escape special characters, or search without is_regex for a literal match.',
        }),
      );
    } else {
      entry.resolve(message.columns as number[]);
    }
  });
  worker.on('error', (error) => {
    fail_pending(
      new code_intelligence_error({
        code: 'internal_error',
        message: 'The regex matching worker failed.',
        cause: error,
      }),
    );
  });
  worker.on('exit', (code) => {
    fail_pending(
      new code_intelligence_error({
        code: 'internal_error',
        message: `The regex matching worker exited (code ${code}).`,
      }),
    );
  });

  return {
    find_all(lines: readonly string[]): Promise<number[]> {
      if (disposed) {
        return Promise.reject(
          new code_intelligence_error({
            code: 'search_timeout',
            message: 'Regex matching was terminated by the time budget.',
          }),
        );
      }
      return new Promise((resolve, reject) => {
        const id = next_id;
        next_id += 1;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, pattern: options.query, flags, lines });
      });
    },
    may_match(): boolean {
      return true;
    },
    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }
      disposed = true;
      fail_pending(
        new code_intelligence_error({
          code: 'search_timeout',
          message: 'Regex matching was terminated by the time budget.',
        }),
      );
      await worker.terminate();
    },
  };
}

function spawn_regex_worker(): Worker {
  try {
    // `type: 'module'` on `eval` workers is supported at runtime but missing
    // from this `@types/node` release, hence the assertion.
    const options = { eval: true, type: 'module' } as ConstructorParameters<typeof Worker>[1];
    return new Worker(REGEX_WORKER_SOURCE, options);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'internal_error',
      message: 'Failed to start the regex matching worker.',
      cause,
    });
  }
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
