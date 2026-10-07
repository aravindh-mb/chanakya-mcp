/**
 * Text and regex search across indexed files.
 *
 * File contents are read from disk rather than stored: the index would double
 * in size for data that is already on the filesystem and would go stale the
 * moment a file changed. The index supplies the *file list*, which is the part
 * worth precomputing — it already has ignore rules, `.gitignore` and size
 * limits applied, so this never searches `node_modules` or a minified bundle.
 *
 * Every match is annotated with the symbol whose body encloses it. That is the
 * part a plain grep cannot provide, and it is frequently enough for an agent to
 * decide without opening the file at all.
 *
 * Regex matching runs in a worker thread (see `pattern.ts`). A batch of lines
 * is sent to the worker, the worker answers with match columns, and if the
 * worker does not answer within the remaining time budget it is **terminated** —
 * the one thing that can interrupt an exponential backtrace, because the engine
 * never yields on its own. The search then stops and reports `timed_out`.
 */

import { readFile } from 'node:fs/promises';
import type { code_symbol } from '../model/symbol.js';
import type { index_store } from '../store/index_store.js';
import { build_line_matcher, type line_matcher } from './pattern.js';
import { escape_like } from './pattern.js';
import {
  DEFAULT_CODE_LIMIT,
  DEFAULT_MATCHES_PER_FILE,
  type code_match,
  type enclosing_symbol,
  type search_code_options,
  type search_code_result,
} from './types.js';

/** Matching lines are trimmed and capped; a result is a pointer, not a payload. */
const MAX_MATCH_TEXT_LENGTH = 300;

export const DEFAULT_TIME_BUDGET_MS = 5_000;

/** Files read at once. Enough to keep the disk busy, few enough to bound memory. */
const READ_CONCURRENCY = 32;

export async function search_code(
  store: index_store,
  options: search_code_options,
): Promise<search_code_result> {
  const matcher = build_line_matcher({
    query: options.query,
    ...(options.is_regex === undefined ? {} : { is_regex: options.is_regex }),
    ...(options.case_sensitive === undefined ? {} : { case_sensitive: options.case_sensitive }),
  });

  const limit = Math.max(0, options.limit ?? DEFAULT_CODE_LIMIT);
  const per_file = Math.max(1, options.max_matches_per_file ?? DEFAULT_MATCHES_PER_FILE);
  const context_lines = Math.max(0, options.context_lines ?? 0);
  const deadline = Date.now() + (options.time_budget_ms ?? DEFAULT_TIME_BUDGET_MS);

  const files = store.list_files({
    ...(options.languages === undefined ? {} : { languages: options.languages }),
    ...(options.path_contains === undefined ? {} : { path_like: `%${escape_like(options.path_contains)}%` }),
  });

  const matches: code_match[] = [];
  let files_searched = 0;
  let timed_out = false;
  let truncated = false;

  try {
    search: for (let offset = 0; offset < files.length; offset += READ_CONCURRENCY) {
      // Reads are issued a window at a time: one at a time leaves the disk idle
      // between files, which on a large repository spent the whole budget on
      // I/O latency before reaching the files that matched. Results are still
      // consumed in index order, so output order does not depend on timing.
      const window = files.slice(offset, offset + READ_CONCURRENCY);
      const sources = await Promise.all(
        window.map((file) =>
          readFile(file.absolute_path, 'utf8').catch(
            // The file was deleted or became unreadable since indexing. Skipping
            // is correct; the next index run will drop it.
            () => undefined,
          ),
        ),
      );

      for (let index = 0; index < window.length; index += 1) {
        const file = window[index]!;
        const source = sources[index];
        if (matches.length >= limit) {
          truncated = true;
          break search;
        }
        // Checked between files rather than between lines: a per-line check
        // would cost more than the matching itself. A batch that overruns is
        // stopped by the deadline below, which terminates the worker.
        if (Date.now() > deadline) {
          timed_out = true;
          break search;
        }
        if (source === undefined) {
          continue;
        }

        files_searched += 1;
        // Most files cannot match at all; ruling that out on the whole source
        // skips splitting and scanning their lines.
        if (!matcher.may_match(source)) {
          continue;
        }

        const lines = source.split('\n');
        const columns = await match_batch_with_deadline(matcher, lines, deadline);
        if (columns === undefined) {
          timed_out = true;
          break search;
        }

        const found = found_from_columns(columns, lines, per_file, limit - matches.length, context_lines);
        if (found.length === 0) {
          continue;
        }

        // Loaded once per file with matches, not once per match.
        const symbols = store.get_symbols_in_file(file.file_path);
        for (const item of found) {
          const enclosing = find_enclosing_symbol(symbols, item.line);
          matches.push({
            file_path: file.file_path,
            ...item,
            ...(enclosing === undefined ? {} : { enclosing }),
          });
        }
      }
    }
  } finally {
    await matcher.dispose();
  }

  return { matches, files_searched, truncated, timed_out };
}

/**
 * Match a file's lines, racing the worker against the time budget.
 *
 * Returns `undefined` when the budget ran out mid-batch. The worker is left to
 * `dispose()`, which terminates it mid-match — the only way to stop a
 * backtracking engine, which never yields on its own.
 */
async function match_batch_with_deadline(
  matcher: line_matcher,
  lines: readonly string[],
  deadline: number,
): Promise<number[] | undefined> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return undefined;
  }

  try {
    return await race_with_timeout(matcher.find_all(lines), remaining);
  } catch (error) {
    if (error instanceof search_timeout_error) {
      return undefined;
    }
    throw error;
  }
}

function race_with_timeout<value_type>(promise: Promise<value_type>, ms: number): Promise<value_type> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new search_timeout_error()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Internal marker for "the budget ran out", distinct from real failures. */
class search_timeout_error extends Error {}

type file_match = Omit<code_match, 'file_path' | 'enclosing'>;

function found_from_columns(
  columns: readonly number[],
  lines: readonly string[],
  per_file: number,
  remaining: number,
  context_lines: number,
): file_match[] {
  const found: file_match[] = [];
  const cap = Math.min(per_file, remaining);

  for (let index = 0; index < columns.length && found.length < cap; index += 1) {
    const column = columns[index] as number;
    if (column === -1) {
      continue;
    }

    const line = lines[index] as string;
    found.push({
      line: index + 1,
      column: column + 1,
      text: shorten(line),
      ...(context_lines === 0
        ? {}
        : {
            context_before: lines.slice(Math.max(0, index - context_lines), index).map(shorten),
            context_after: lines.slice(index + 1, index + 1 + context_lines).map(shorten),
          }),
    });
  }

  return found;
}

/**
 * The innermost symbol containing `line`.
 *
 * Innermost rather than outermost: knowing a match is in `create_user` is far
 * more useful than knowing it is somewhere in `user_service`.
 */
function find_enclosing_symbol(symbols: readonly code_symbol[], line: number): enclosing_symbol | undefined {
  let best: code_symbol | undefined;

  for (const symbol of symbols) {
    if (symbol.start_line > line || symbol.end_line < line) {
      continue;
    }
    // A tighter span means a more deeply nested symbol.
    if (best === undefined || symbol.end_line - symbol.start_line < best.end_line - best.start_line) {
      best = symbol;
    }
  }

  return best === undefined ? undefined : { id: best.id, name: best.name, kind: best.kind };
}

function shorten(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= MAX_MATCH_TEXT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_MATCH_TEXT_LENGTH - 3)}...`;
}
