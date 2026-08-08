/**
 * Filesystem watching with debounced reindexing.
 *
 * Uses `fs.watch` in recursive mode rather than taking a watcher dependency.
 * That is a real trade: recursive mode is unavailable on some platform and Node
 * combinations, so the failure is detected at start and reported with a clear
 * message instead of silently watching nothing.
 *
 * On each quiet period the watcher re-runs `index_project`. Re-walking the
 * directory tree costs a `stat` per file — about 11ms on this repository and
 * 360ms on a 5,000 file tree — while *parsing* is the expensive part, and
 * change detection means only genuinely edited files are parsed. Reusing the
 * normal indexing path also means the watcher inherits the full ignore rules,
 * including nested `.gitignore` files, rather than reimplementing them and
 * drifting out of step.
 */

import { watch, type FSWatcher } from 'node:fs';
import { code_intelligence_error, describe_unknown_error } from '../core/errors.js';
import { index_project, type index_project_options, type index_project_result } from './index_project.js';

/**
 * Quiet period before reindexing. Editors emit several events for one save
 * (write, rename, attribute change), and formatters or a `git checkout` produce
 * bursts across many files. Waiting for the burst to end turns that into one
 * pass instead of dozens.
 */
export const DEFAULT_DEBOUNCE_MS = 300;

export interface watch_project_options extends index_project_options {
  readonly debounce_ms?: number;
  /** Called after each reindex triggered by a change. */
  readonly on_index?: (result: index_project_result) => void;
  /** Called when a reindex throws. Watching continues regardless. */
  readonly on_error?: (error: unknown) => void;
}

export interface watch_handle {
  /** Stop watching. Safe to call more than once. */
  close(): void;
  /** True until `close()` is called. */
  readonly is_watching: boolean;
  /** Resolves once any in-flight or pending reindex has finished. For tests. */
  settled(): Promise<void>;
}

export function watch_project(options: watch_project_options): watch_handle {
  const debounce_ms = options.debounce_ms ?? DEFAULT_DEBOUNCE_MS;
  const log = options.logger;

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let closed = false;
  let pending = false;

  const run_index = async (): Promise<void> => {
    if (closed) {
      return;
    }
    try {
      const result = await index_project(options);
      log?.debug(
        `reindexed after change: +${result.files_added} ~${result.files_updated} ` +
          `-${result.files_removed} (${result.files_parsed} parsed) in ${result.duration_ms}ms`,
      );
      options.on_index?.(result);
    } catch (error: unknown) {
      // A failed reindex must not kill the watcher; the next save may well fix
      // whatever broke it.
      log?.error(`reindex failed: ${describe_unknown_error(error)}`);
      options.on_error?.(error);
    }
  };

  const schedule = (): void => {
    pending = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      pending = false;
      // Chained so two bursts can never reindex concurrently and interleave
      // writes to the same file.
      running = running.then(run_index);
    }, debounce_ms);
    // Do not hold the process open purely to wait out a debounce.
    timer.unref?.();
  };

  const watcher = create_watcher(options.root_path, (changed_path) => {
    if (closed || is_self_generated(changed_path)) {
      return;
    }
    schedule();
  });

  watcher.on('error', (error) => {
    log?.error(`watcher error: ${describe_unknown_error(error)}`);
    options.on_error?.(error);
  });

  return {
    get is_watching(): boolean {
      return !closed;
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher.close();
    },
    async settled(): Promise<void> {
      // Wait out a pending debounce first, then the reindex it schedules.
      while (pending || timer !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, debounce_ms / 2 + 5));
      }
      await running;
    },
  };
}

function create_watcher(root_path: string, on_change: (changed_path: string) => void): FSWatcher {
  try {
    return watch(root_path, { recursive: true }, (_event, filename) => {
      on_change(filename === null ? '' : filename.toString());
    });
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'watch_unavailable',
      message: `The project could not be watched at ${root_path}: ${describe_unknown_error(cause)}`,
      hint: 'Recursive file watching is unavailable on this platform or Node version. Re-run indexing manually instead.',
      cause,
    });
  }
}

/**
 * Ignore writes the indexer makes itself.
 *
 * Without this the database write at the end of a reindex triggers the watcher,
 * which reindexes, which writes again — an endless loop.
 */
function is_self_generated(changed_path: string): boolean {
  const normalized = changed_path.split('\\').join('/');
  return normalized === '.code-intelligence' || normalized.startsWith('.code-intelligence/');
}
